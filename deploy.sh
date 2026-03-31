#!/bin/bash
# Deploy heydex-website diff pages to VPS
# Usage: ./deploy.sh [--dry-run]

set -e

VPS="dex@57.129.134.24"
LOCAL="$(dirname "$0")/diff/"
STAGING="/home/dex/diff-update/"
LIVE="/var/www/heydex/diff/"

if [ "$1" = "--dry-run" ]; then
  echo "=== DRY RUN ==="
  rsync -avzn --delete "$LOCAL" "$VPS:$STAGING"
  exit 0
fi

echo "→ Syncing to staging..."
rsync -avz --delete "$LOCAL" "$VPS:$STAGING"

echo "→ Promoting to live..."
ssh "$VPS" "cp -r $STAGING* $LIVE"

echo "✓ Deployed to heydex.ai/diff/"
