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
STAGING="/tmp/heydex-deploy/"
LIVE_DIFF="/var/www/heydex/diff/"
LIVE_CONNECT="/var/www/heydex/connect/"

# The live route precedence is defined by Caddy on the host and mirrored in
# ops/Caddyfile.heydex. This script only updates the static assets under those roots.

if [ "$1" = "--dry-run" ]; then
  echo "=== DRY RUN ==="
  rsync -avzn --delete -e "ssh -i $SSH_KEY" "$LOCAL" "$VPS:$STAGING"
  exit 0
fi

cleanup() {
  rm -rf "$TMP_DIFF" "$TMP_CONNECT"
}
trap cleanup EXIT

cp -R "$LOCAL". "$TMP_DIFF/"
cp -R "$LOCAL". "$TMP_CONNECT/"

python3 - <<'PY' "$TMP_DIFF/index.html" "/diff/" "$TMP_CONNECT/index.html" "/connect/"
from pathlib import Path
import sys

def inject_base(index_path: str, base_href: str) -> None:
    path = Path(index_path)
    html = path.read_text()
    html = html.replace('<base href="/diff/">', '').replace('<base href="/connect/">', '')
    html = html.replace("<head>", f"<head>\n  <base href=\"{base_href}\">", 1)
    path.write_text(html)

inject_base(sys.argv[1], sys.argv[2])
inject_base(sys.argv[3], sys.argv[4])
PY

echo "→ Syncing to staging..."
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_DIFF/" "$VPS:$STAGING/diff/"
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_CONNECT/" "$VPS:$STAGING/connect/"

echo "→ Promoting to live..."
ssh -i "$SSH_KEY" "$VPS" "sudo rm -rf ${LIVE_DIFF}* ${LIVE_CONNECT}* && sudo cp -r $STAGING/diff/* $LIVE_DIFF && sudo cp -r $STAGING/connect/* $LIVE_CONNECT && sudo chown -R dex:dex $LIVE_DIFF $LIVE_CONNECT"

echo "→ Deploying static HTML subdirectories..."
STATIC_SUBDIRS="@dave community company love-letters roadmap welcome admin"
for subdir in $STATIC_SUBDIRS; do
  echo "  Copying diff/$subdir/..."
  rsync -avz -e "ssh -i $SSH_KEY" "$(dirname "$0")/diff/$subdir/" "$VPS:/tmp/heydex-static-$subdir/"
  ssh -i "$SSH_KEY" "$VPS" "sudo cp -r /tmp/heydex-static-$subdir $LIVE_DIFF$subdir && sudo chown -R dex:dex $LIVE_DIFF$subdir"
done

echo "✓ Deployed React app to:"
echo "  - heydex.ai/diff/"
echo "  - heydex.ai/connect/"

echo ""
echo "→ Ensuring database is seeded..."
npm run db:ensure

echo ""
echo "✓ Deployment complete"
