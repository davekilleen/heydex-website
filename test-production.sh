#!/bin/bash
set -euo pipefail
BASE_URL="${1:-https://heydex.ai}"
echo "Testing $BASE_URL"
curl -sf "$BASE_URL/connect/" | grep -q 'id="root"' && echo "✅ /connect/ OK" || exit 1
curl -sf "$BASE_URL/connect/" | grep -q '<base href="/connect/">' && echo "✅ /connect base href OK" || exit 1

assert_diff_gate_redirect() {
  local path="$1"
  local headers
  headers="$(curl -sS -o /dev/null -D - "$BASE_URL$path")"
  grep -qE '^HTTP/[^ ]+ 302([[:space:]]|$)' <<<"$headers" || {
    echo "Expected 302 for $path" >&2
    exit 1
  }
  grep -qiE '^location: .*/oauth2-diff/start' <<<"$headers" || {
    echo "Expected $path to redirect to /oauth2-diff/start" >&2
    exit 1
  }
  echo "✅ $path -> 302 /oauth2-diff/start"
}

assert_diff_gate_redirect "/diff/"
assert_diff_gate_redirect "/diff/profile/"
assert_diff_gate_redirect "/diff/review/"
assert_diff_gate_redirect "/diff/@route-smoke/"
echo "✅ Tests passed"

# Caddy drift check — warning only. We want to see how often this trips before
# making it blocking. See scripts/check-caddy-drift.sh.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCRIPT_DIR/scripts/check-caddy-drift.sh" ]; then
  echo ""
  echo "→ Checking Caddy config drift (advisory)..."
  if ! "$SCRIPT_DIR/scripts/check-caddy-drift.sh"; then
    echo "⚠️  Caddy drift check reported issues — not failing the run (advisory only)."
  fi
fi
