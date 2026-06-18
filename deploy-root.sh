#!/bin/bash
# Deploy the root marketing landing page AND its root-relative assets to heydex.ai.
#
# The site root (heydex.ai/) is served by Caddy as /var/www/heydex/index.html.
# Its SOURCE in this repo is index-landing.html — NOT index.html, which is the
# React SPA entry for the /diff and /connect surfaces. The landing page also
# references root-relative images (testimonial photos + the Open Graph card).
#
# Historically the root marketing surface was deployed by hand and drifted out
# of sync (the live homepage fell back to the old heydex.io domain and its
# images 404'd — see docs/DEPLOYMENT.md). This script makes the HTML and its
# assets move together so the homepage and its images can never diverge again.
# deploy.sh calls it on every frontend deploy.
#
# Additive/idempotent: it only writes /var/www/heydex/index.html, the named
# image files, and the shots/ and clips/ asset dirs (the homepage references
# ./shots/* and ./clips/*). It does NOT touch /diff, /connect, or the Caddy config.
#
# Usage:  ./deploy-root.sh
set -e

VPS="ubuntu@57.129.134.24"
SSH_KEY="$HOME/.ssh/acfs_ed25519"
DIR="$(cd "$(dirname "$0")" && pwd)"

# Local source for the host's /var/www/heydex/index.html (the marketing root).
ROOT_HTML="index-landing.html"
# Root-relative image assets the landing page references.
# og-image.png is the Open Graph social-share card (source: og-image.html).
PHOTOS=(dave-stage.png ed-biden.png matt-lemay.png og-image.png)

# Fail early if any source is missing locally.
[ -f "$DIR/$ROOT_HTML" ] || { echo "✗ missing local source: $ROOT_HTML" >&2; exit 1; }
for f in "${PHOTOS[@]}"; do
  [ -f "$DIR/$f" ] || { echo "✗ missing local source: $f" >&2; exit 1; }
done
# Asset dirs the homepage references via ./shots/* and ./clips/* (must be non-empty).
for d in shots clips; do
  { [ -d "$DIR/$d" ] && [ -n "$(ls -A "$DIR/$d" 2>/dev/null)" ]; } || { echo "✗ missing or empty local asset dir: $d" >&2; exit 1; }
done

echo "→ Staging root page + assets on host..."
ssh -i "$SSH_KEY" "$VPS" "mkdir -p /tmp/heydex-root"
scp -i "$SSH_KEY" "$DIR/$ROOT_HTML" "${PHOTOS[@]/#/$DIR/}" "$VPS:/tmp/heydex-root/"
# Stage the asset dirs into the staging area (trailing slashes = sync dir contents).
# --delete here only mirrors INTO the temp staging subdirs, never the live web root.
rsync -az --delete -e "ssh -i $SSH_KEY" "$DIR/shots/" "$VPS:/tmp/heydex-root/shots/"
rsync -az --delete -e "ssh -i $SSH_KEY" "$DIR/clips/" "$VPS:/tmp/heydex-root/clips/"

echo "→ Promoting to live (/var/www/heydex/)..."
ssh -i "$SSH_KEY" "$VPS" "\
  sudo cp /tmp/heydex-root/$ROOT_HTML /var/www/heydex/index.html && \
  sudo cp /tmp/heydex-root/*.png /var/www/heydex/ && \
  sudo chown dex:dex /var/www/heydex/index.html && \
  for f in ${PHOTOS[*]}; do sudo chown dex:dex \"/var/www/heydex/\$f\"; done && \
  sudo mkdir -p /var/www/heydex/shots /var/www/heydex/clips && \
  sudo rsync -a --delete /tmp/heydex-root/shots/ /var/www/heydex/shots/ && \
  sudo rsync -a --delete /tmp/heydex-root/clips/ /var/www/heydex/clips/ && \
  sudo chown -R dex:dex /var/www/heydex/shots /var/www/heydex/clips"

echo "→ Verifying live..."
fail=0
root_code=$(curl -sS -o /tmp/heydex-verify-root.html -w "%{http_code}" https://heydex.ai/ || echo ERR)
echo "  https://heydex.ai/ → $root_code"
[ "$root_code" = "200" ] || fail=1
# Confirm the freshly-deployed HTML actually landed (canonical tag only exists in the new file).
if grep -q 'rel="canonical" href="https://heydex.ai/"' /tmp/heydex-verify-root.html; then
  echo "  homepage is the current heydex.ai build ✓"
else
  echo "  ✗ homepage does not look like the new build (stale content?)"; fail=1
fi
for f in "${PHOTOS[@]}"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://heydex.ai/$f")
  echo "  https://heydex.ai/$f → $code"
  [ "$code" = "200" ] || fail=1
done
# Spot-check one asset from each synced dir.
for a in shots/brief-home.png clips/plan.mp4; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://heydex.ai/$a")
  echo "  https://heydex.ai/$a → $code"
  [ "$code" = "200" ] || fail=1
done

[ "$fail" = "0" ] && echo "✓ Root marketing page + assets deployed" || { echo "✗ verification failed" >&2; exit 1; }
