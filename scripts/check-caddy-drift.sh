#!/bin/bash
# Detect drift between the live Caddyfile on the VPS and ops/Caddyfile.heydex.
# Read-only: NEVER writes to the live host.
#
# Usage: ./scripts/check-caddy-drift.sh
# Exit codes:
#   0 = identical
#   1 = drift detected (diff printed to stdout)
#   2 = unable to fetch (ssh/file error)

set -u

VPS="${HEYDEX_VPS:-ubuntu@57.129.134.24}"
SSH_KEY="${HEYDEX_SSH_KEY:-$HOME/.ssh/acfs_ed25519}"
REMOTE_CADDYFILE="/etc/caddy/Caddyfile"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_CADDYFILE="$REPO_ROOT/ops/Caddyfile.heydex"

if [ ! -f "$LOCAL_CADDYFILE" ]; then
  echo "ERR  missing $LOCAL_CADDYFILE" >&2
  exit 2
fi

TMP_REMOTE="$(mktemp /tmp/heydex-caddy-remote.XXXXXX)"
trap 'rm -f "$TMP_REMOTE"' EXIT

if ! ssh -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10 "$VPS" "sudo cat $REMOTE_CADDYFILE" > "$TMP_REMOTE" 2>/dev/null; then
  echo "ERR  could not read $REMOTE_CADDYFILE from $VPS" >&2
  exit 2
fi

if diff -u "$LOCAL_CADDYFILE" "$TMP_REMOTE" > /dev/null; then
  echo "✓ Caddy config in sync with ops/Caddyfile.heydex"
  exit 0
fi

echo "⚠ Caddy drift detected (local ops/Caddyfile.heydex vs live $VPS:$REMOTE_CADDYFILE):"
diff -u "$LOCAL_CADDYFILE" "$TMP_REMOTE" || true
exit 1
