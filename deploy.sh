#!/bin/bash
# Deploy heydex-website React app to the live Caddy host
# Usage: ./deploy.sh [--dry-run] [--skip-tests]

set -e

# Run smoke tests before deploying (unless --skip-tests)
if [[ "$1" != "--skip-tests" ]] && [[ "$2" != "--skip-tests" ]]; then
  echo "🧪 Running pre-deploy tests..."
  ./test-production.sh https://heydex.ai
  echo ""
fi

echo "🏗️ Building React app..."
npm run build
echo ""

VPS="ubuntu@57.129.134.24"
SSH_KEY="~/.ssh/acfs_ed25519"
LOCAL="$(dirname "$0")/dist/"
TMP_DIFF="$(mktemp -d /tmp/heydex-diff.XXXXXX)"
TMP_CONNECT="$(mktemp -d /tmp/heydex-connect.XXXXXX)"
TMP_DESKTOP="$(mktemp -d /tmp/heydex-desktop.XXXXXX)"
STAGING="/tmp/heydex-deploy/"
LIVE_DIFF="/var/www/heydex/diff/"
LIVE_CONNECT="/var/www/heydex/connect/"
LIVE_DESKTOP="/var/www/heydex/desktop/"
DESKTOP_HELP_SITE="${DESKTOP_HELP_SITE:-$(dirname "$0")/../dex-desktop-concierge/help/site/}"
DESKTOP_HELP_SITE="${DESKTOP_HELP_SITE%/}/"

# The live route precedence is defined by Caddy on the host and mirrored in
# ops/Caddyfile.heydex. This script only updates the static assets under those roots.
#
# Caddy config is NOT auto-deployed from this repo. Drift between the live
# /etc/caddy/Caddyfile and ops/Caddyfile.heydex is detected (read-only) by
# scripts/check-caddy-drift.sh, which runs as an advisory warning inside
# test-production.sh. ops/Caddyfile.heydex is the source of truth; if the
# drift check fires, reconcile manually on the host before treating the Caddy
# contract as accurate.

if [ "$1" = "--dry-run" ]; then
  echo "=== DRY RUN ==="
  rsync -avzn --delete -e "ssh -i $SSH_KEY" "$LOCAL" "$VPS:$STAGING"
  exit 0
fi

cleanup() {
  rm -rf "$TMP_DIFF" "$TMP_CONNECT" "$TMP_DESKTOP"
}
trap cleanup EXIT

cp -R "$LOCAL". "$TMP_DIFF/"
cp -R "$LOCAL". "$TMP_CONNECT/"
cp -R "$LOCAL". "$TMP_DESKTOP/"

python3 - <<'PY' "$TMP_DIFF/index.html" "/diff/" "$TMP_CONNECT/index.html" "/connect/" "$TMP_DESKTOP/index.html" "/desktop/"
from pathlib import Path
import sys

def inject_base(index_path: str, base_href: str) -> None:
    path = Path(index_path)
    html = path.read_text()
    for existing in ("/diff/", "/connect/", "/desktop/"):
        html = html.replace(f'<base href="{existing}">', '')
    html = html.replace("<head>", f"<head>\n  <base href=\"{base_href}\">", 1)
    path.write_text(html)

for index in range(1, len(sys.argv), 2):
    inject_base(sys.argv[index], sys.argv[index + 1])
PY

if [ ! -d "$DESKTOP_HELP_SITE" ]; then
  echo "Desktop help site not found at $DESKTOP_HELP_SITE"
  echo "Set DESKTOP_HELP_SITE to the built help/site directory before deploying."
  exit 1
fi

echo "→ Syncing to staging..."
ssh -i "$SSH_KEY" "$VPS" "mkdir -p \"$STAGING/diff\" \"$STAGING/connect\" \"$STAGING/desktop/help\""   # ensure staging dirs exist (rsync won't create missing parents)
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_DIFF/" "$VPS:$STAGING/diff/"
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_CONNECT/" "$VPS:$STAGING/connect/"
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_DESKTOP/" "$VPS:$STAGING/desktop/"
rsync -avz --delete -e "ssh -i $SSH_KEY" "$DESKTOP_HELP_SITE" "$VPS:$STAGING/desktop/help/"

echo "→ Promoting to live..."
ssh -i "$SSH_KEY" "$VPS" "sudo rm -rf ${LIVE_DIFF}* ${LIVE_CONNECT}* && sudo cp -r $STAGING/diff/* $LIVE_DIFF && sudo cp -r $STAGING/connect/* $LIVE_CONNECT && sudo chown -R dex:dex $LIVE_DIFF $LIVE_CONNECT"
ssh -i "$SSH_KEY" "$VPS" "sudo mkdir -p $LIVE_DESKTOP && sudo rsync -a --delete --exclude downloads/ $STAGING/desktop/ $LIVE_DESKTOP && sudo chown -R dex:dex $LIVE_DESKTOP"

# Beta DMG: ship the installer through the same staging pipeline when provided.
# Usage: DESKTOP_DMG=~/Downloads/Dex-1.0.0-arm64.dmg ./deploy.sh
if [ -n "${DESKTOP_DMG:-}" ]; then
  if [ ! -f "$DESKTOP_DMG" ]; then
    echo "DESKTOP_DMG set but file not found: $DESKTOP_DMG" >&2
    exit 1
  fi
  echo "-> Shipping beta DMG..."
  ssh -i "$SSH_KEY" "$VPS" "mkdir -p \"$STAGING/desktop-dmg\""
  rsync -avz -e "ssh -i $SSH_KEY" "$DESKTOP_DMG" "$VPS:$STAGING/desktop-dmg/"
  ssh -i "$SSH_KEY" "$VPS" "sudo mkdir -p ${LIVE_DESKTOP}downloads && sudo rsync -a $STAGING/desktop-dmg/ ${LIVE_DESKTOP}downloads/ && sudo chown -R dex:dex ${LIVE_DESKTOP}downloads"
fi

echo "→ Deploying static HTML subdirectories..."
STATIC_SUBDIRS="community company love-letters roadmap welcome admin like-dave"
for subdir in $STATIC_SUBDIRS; do
  echo "  Copying diff/$subdir/..."
  rsync -avz -e "ssh -i $SSH_KEY" "$(dirname "$0")/diff/$subdir/" "$VPS:/tmp/heydex-static-$subdir/"
  ssh -i "$SSH_KEY" "$VPS" "sudo cp -r /tmp/heydex-static-$subdir $LIVE_DIFF$subdir && sudo chown -R dex:dex $LIVE_DIFF$subdir"
done

echo ""
echo "→ Deploying root marketing page + assets..."
# The marketing homepage (heydex.ai/) and its root-relative images are NOT part
# of the /diff or /connect React surfaces. Deploy the HTML and its assets together
# so they can never drift out of sync (stale domain / 404'd images) again.
"$(dirname "$0")/deploy-root.sh"

echo ""
echo "✓ Deployed React app to:"
echo "  - heydex.ai/diff/"
echo "  - heydex.ai/connect/"
echo "  - heydex.ai/desktop/"
echo "  - heydex.ai/ (marketing homepage + root images)"

echo ""
echo "→ Ensuring database is seeded..."
npm run db:ensure

echo ""
echo "✓ Deployment complete"
