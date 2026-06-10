#!/bin/bash
# Tests for install-diff.sh against temp fixture vaults.
#
# Proves the seeding invariant the bootstrap must honor:
#   1. fresh install adds all 7 files
#   2. re-run is idempotent (adds nothing, says so)
#   3. an existing user file survives byte-for-byte (NEVER overwritten)
#   4. piped stdin mode works (curl ... | bash equivalent)
#   5. refuses politely outside a Dex vault
#
# Run: bash scripts/test-install-diff.sh
set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLER="$REPO_ROOT/install-diff.sh"
EXPECTED_FILES=7

FAILURES=0
check() { # name, condition-result(0/1)
  if [ "$2" -eq 0 ]; then
    echo "  ok    $1"
  else
    echo "  FAIL  $1"
    FAILURES=$((FAILURES + 1))
  fi
}

make_vault() {
  local dir
  dir="$(mktemp -d /tmp/dexdiff-installer-test.XXXXXX)"
  mkdir -p "$dir/.claude"
  echo "# Test vault" > "$dir/CLAUDE.md"
  echo "$dir"
}

count_skill_files() {
  find "$1/.claude/skills" -type f 2>/dev/null | wc -l | tr -d ' '
}

[ -f "$INSTALLER" ] || { echo "install-diff.sh not built — run scripts/build-install-diff.mjs first"; exit 1; }

# ---------------------------------------------------------------------------
echo "1. Fresh install"
VAULT="$(make_vault)"
OUTPUT="$(DEX_VAULT="$VAULT" bash "$INSTALLER" 2>&1)"
check "exit 0" $?
COUNT="$(count_skill_files "$VAULT")"
[ "$COUNT" = "$EXPECTED_FILES" ]; check "installs $EXPECTED_FILES files (got $COUNT)" $?
echo "$OUTPUT" | grep -q "Added $EXPECTED_FILES file(s)"; check "reports added count" $?
echo "$OUTPUT" | grep -q "diff-adopt-profile/SKILL.md"; check "lists what it added" $?
[ -x "$VAULT/.claude/skills/diff-adopt-profile/scripts/adopt_profile.py" ]; check "adopt script is executable" $?
grep -q "api.heydex.ai" "$VAULT/.claude/skills/diff-adopt-profile/SKILL.md"; check "installed skill carries the fixed API host" $?

# ---------------------------------------------------------------------------
echo "2. Idempotent re-run"
BEFORE_HASH="$(find "$VAULT/.claude/skills" -type f -exec shasum -a 256 {} \; | sort | shasum -a 256)"
OUTPUT2="$(DEX_VAULT="$VAULT" bash "$INSTALLER" 2>&1)"
check "exit 0" $?
AFTER_HASH="$(find "$VAULT/.claude/skills" -type f -exec shasum -a 256 {} \; | sort | shasum -a 256)"
[ "$BEFORE_HASH" = "$AFTER_HASH" ]; check "no file changed on re-run" $?
echo "$OUTPUT2" | grep -q "Added 0 file(s), kept $EXPECTED_FILES"; check "reports kept count" $?
echo "$OUTPUT2" | grep -q "already installed"; check "says nothing changed" $?

# ---------------------------------------------------------------------------
echo "3. Existing user file survives byte-for-byte"
VAULT3="$(make_vault)"
mkdir -p "$VAULT3/.claude/skills/diff-adopt"
printf 'MY CUSTOMISED SKILL\nline two with bytes: \xc3\xa9\n' > "$VAULT3/.claude/skills/diff-adopt/SKILL.md"
USER_SHA_BEFORE="$(shasum -a 256 "$VAULT3/.claude/skills/diff-adopt/SKILL.md" | cut -d' ' -f1)"
OUTPUT3="$(DEX_VAULT="$VAULT3" bash "$INSTALLER" 2>&1)"
check "exit 0" $?
USER_SHA_AFTER="$(shasum -a 256 "$VAULT3/.claude/skills/diff-adopt/SKILL.md" | cut -d' ' -f1)"
[ "$USER_SHA_BEFORE" = "$USER_SHA_AFTER" ]; check "user file untouched (sha identical)" $?
echo "$OUTPUT3" | grep -q "kept   .claude/skills/diff-adopt/SKILL.md"; check "reports the kept file" $?
echo "$OUTPUT3" | grep -q "Added 6 file(s), kept 1"; check "adds the other 6" $?

# ---------------------------------------------------------------------------
echo "4. Piped stdin mode (curl | bash equivalent)"
VAULT4="$(make_vault)"
OUTPUT4="$(cd "$VAULT4" && cat "$INSTALLER" | bash 2>&1)"
check "exit 0" $?
COUNT4="$(count_skill_files "$VAULT4")"
[ "$COUNT4" = "$EXPECTED_FILES" ]; check "vault detected from cwd, $EXPECTED_FILES files installed" $?

# ---------------------------------------------------------------------------
echo "5. Refuses outside a Dex vault"
NOT_VAULT="$(mktemp -d /tmp/dexdiff-installer-test.XXXXXX)"
set +e
OUTPUT5="$(cd "$NOT_VAULT" && cat "$INSTALLER" | bash 2>&1)"
RC5=$?
set -e
[ "$RC5" -ne 0 ]; check "non-zero exit" $?
echo "$OUTPUT5" | grep -q "does not look like a Dex vault"; check "explains the problem" $?
echo "$OUTPUT5" | grep -q "DEX_VAULT="; check "offers the env-var fix" $?
[ ! -d "$NOT_VAULT/.claude" ]; check "wrote nothing" $?

echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES assertion(s) FAILED"
  exit 1
fi
echo "All installer assertions passed."
