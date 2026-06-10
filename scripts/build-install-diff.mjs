#!/usr/bin/env node
/**
 * Build install-diff.sh — the one-command bootstrap that drops the six
 * /diff-* skills into a user's Dex vault.
 *
 * Why it exists: the DexDiff command surface has never shipped in public
 * dex-core (break 0 in the 2026-06-10 review), so a stranger's fresh install
 * has no diff commands at all. Hosting this script on heydex.ai sidesteps
 * the dex-core release train for the keynote. This is product-code
 * distribution by the product's own site — not foreign-workflow installation,
 * so it does not violate the v2 "never install foreign code" principle.
 *
 * Source of truth for the skills: the dex-core branch checkout passed via
 * --skills-root. Regenerate whenever a SKILL.md changes:
 *
 *   node scripts/build-install-diff.mjs \
 *     --skills-root /path/to/dex-core-checkout/.claude/skills
 *
 * Output: install-diff.sh at the repo root (commit it — deploy-funnel.sh
 * ships it to the web root, served at https://heydex.ai/install-diff).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(REPO_ROOT, "install-diff.sh");

const SKILLS = [
  "diff-adopt",
  "diff-adopt-profile",
  "diff-generate",
  "diff-list",
  "diff-profile",
  "diff-remove",
];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const rootIndex = argv.indexOf("--skills-root");
if (rootIndex === -1 || !argv[rootIndex + 1]) {
  fail("usage: node scripts/build-install-diff.mjs --skills-root <dex-core>/.claude/skills");
}
const skillsRoot = path.resolve(argv[rootIndex + 1]);
if (!fs.existsSync(skillsRoot)) fail(`skills root not found: ${skillsRoot}`);

// Record provenance (best effort)
let sourceCommit = "unknown";
try {
  sourceCommit = execSync("git rev-parse --short HEAD", {
    cwd: skillsRoot,
    encoding: "utf-8",
  }).trim();
} catch {
  /* fine */
}

// Collect every file in each skill directory
const files = [];
for (const skill of SKILLS) {
  const skillDir = path.join(skillsRoot, skill);
  if (!fs.existsSync(skillDir)) fail(`missing skill: ${skillDir}`);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !entry.name.startsWith(".")) {
        files.push({
          relative: path.relative(skillsRoot, full),
          content: fs.readFileSync(full),
        });
      }
    }
  };
  walk(skillDir);
}
if (files.length === 0) fail("no skill files found");

const payloadSections = files
  .map((file, index) => {
    const b64 = file.content.toString("base64");
    // wrap at 76 cols for readability
    const wrapped = b64.replace(/(.{76})/g, "$1\n");
    const marker = `DEX_PAYLOAD_${index}`;
    return `install_file "${file.relative}" <<'${marker}'\n${wrapped}\n${marker}`;
  })
  .join("\n\n");

const generatedAt = new Date().toISOString();

const script = `#!/bin/bash
# ============================================================================
# Dex diff commands — one-command installer
#
#   curl -fsSL https://heydex.ai/install-diff | bash
#
# Installs the six /diff-* skills (adopt workflows shared on heydex.ai/diff)
# into your Dex vault's .claude/skills/ folder.
#
# Safety contract:
#   - NEVER overwrites a file you already have (your customisations win)
#   - writes only inside <your vault>/.claude/skills/
#   - prints exactly what it added and what it left alone
#   - re-running is always safe
#
# GENERATED FILE — do not edit by hand.
# Built by scripts/build-install-diff.mjs from dex-core ${sourceCommit}
# at ${generatedAt} (${files.length} files).
# ============================================================================

set -e

BOLD='\\033[1m'; GREEN='\\033[0;32m'; YELLOW='\\033[1;33m'; RED='\\033[0;31m'; NC='\\033[0m'
say()  { printf "%b\\n" "$1"; }

say ""
say "\${BOLD}Dex diff commands installer\${NC}"
say "Brings /diff-adopt-profile (\\"set me up like Dave\\") and friends into your Dex."
say ""

# ----------------------------------------------------------------------------
# 1. Find the Dex vault
#    Order: $DEX_VAULT > current folder > interactive prompt (terminal only)
# ----------------------------------------------------------------------------
is_vault() { [ -d "$1/.claude" ] && [ -f "$1/CLAUDE.md" ]; }

VAULT=""
if [ -n "\${DEX_VAULT:-}" ]; then
  if is_vault "$DEX_VAULT"; then
    VAULT="$DEX_VAULT"
  else
    say "\${RED}DEX_VAULT is set to $DEX_VAULT but that does not look like a Dex vault\${NC}"
    say "(expected a .claude folder and a CLAUDE.md file inside it)"
    exit 1
  fi
elif is_vault "$(pwd)"; then
  VAULT="$(pwd)"
elif [ -t 1 ] && [ -r /dev/tty ]; then
  say "\${YELLOW}This folder does not look like a Dex vault.\${NC}"
  say "A Dex vault contains a .claude folder and a CLAUDE.md file."
  printf "Path to your Dex folder (or press Enter to cancel): "
  read -r VAULT_INPUT < /dev/tty || VAULT_INPUT=""
  if [ -z "$VAULT_INPUT" ]; then
    say "Cancelled. Nothing was changed."
    exit 1
  fi
  VAULT_INPUT="\${VAULT_INPUT/#\\~/$HOME}"
  if is_vault "$VAULT_INPUT"; then
    VAULT="$VAULT_INPUT"
  else
    say "\${RED}$VAULT_INPUT does not look like a Dex vault. Nothing was changed.\${NC}"
    say "Install Dex first: https://heydex.ai"
    exit 1
  fi
else
  say "\${RED}This folder does not look like a Dex vault\${NC} (no .claude folder + CLAUDE.md)."
  say ""
  say "Fix one of two ways, then re-run:"
  say "  1. cd into your Dex folder first, or"
  say "  2. DEX_VAULT=/path/to/your/dex  curl -fsSL https://heydex.ai/install-diff | bash"
  say ""
  say "Don't have Dex yet? Start at https://heydex.ai"
  exit 1
fi

say "Vault: \${BOLD}$VAULT\${NC}"

# ----------------------------------------------------------------------------
# 2. Prerequisites (warn-only — nothing here blocks the install)
# ----------------------------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  say "\${GREEN}ok\${NC}    python3 found ($(python3 -V 2>&1))"
else
  say "\${YELLOW}note\${NC}  python3 not found — /diff-adopt-profile will use its manual fallback"
fi

if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 5 -o /dev/null "https://api.heydex.ai/api/diffs" 2>/dev/null; then
    say "\${GREEN}ok\${NC}    api.heydex.ai reachable"
  else
    say "\${YELLOW}note\${NC}  could not reach api.heydex.ai right now — adopting will need internet"
  fi
fi

say ""

# ----------------------------------------------------------------------------
# 3. Install files (never overwrite — your existing files always win)
# ----------------------------------------------------------------------------
ADDED=0
KEPT=0
ADDED_LIST=""
KEPT_LIST=""

install_file() {
  target="$VAULT/.claude/skills/$1"
  if [ -e "$target" ]; then
    KEPT=$((KEPT + 1))
    KEPT_LIST="\${KEPT_LIST}  kept   .claude/skills/$1 (you already have this — not touched)\\n"
    # still consume the heredoc payload from stdin
    cat > /dev/null
    return 0
  fi
  mkdir -p "$(dirname "$target")"
  base64 --decode > "$target"
  case "$target" in *.py|*.sh) chmod +x "$target" ;; esac
  ADDED=$((ADDED + 1))
  ADDED_LIST="\${ADDED_LIST}  added  .claude/skills/$1\\n"
}

${payloadSections}

# ----------------------------------------------------------------------------
# 4. Report exactly what happened
# ----------------------------------------------------------------------------
say "\${BOLD}Done.\${NC} Added $ADDED file(s), kept $KEPT existing file(s) untouched."
say ""
[ -n "$ADDED_LIST" ] && printf "%b" "$ADDED_LIST"
[ -n "$KEPT_LIST" ] && printf "%b" "$KEPT_LIST"
say ""
if [ "$ADDED" -eq 0 ]; then
  say "Everything was already installed — nothing changed."
fi
say "\${BOLD}Next:\${NC} open Claude Code in your Dex folder and say:"
say ""
say "    \${BOLD}set me up like Dave\${NC}"
say ""
say "(or run: /diff-adopt-profile @davekilleen)"
say ""
`;

fs.writeFileSync(OUTPUT, script, { mode: 0o755 });
const stat = fs.statSync(OUTPUT);
console.log(`✓ ${path.relative(REPO_ROOT, OUTPUT)} generated`);
console.log(`  ${files.length} embedded files from dex-core ${sourceCommit}, ${(stat.size / 1024).toFixed(1)} KB`);
for (const file of files) console.log(`    ${file.relative}`);
