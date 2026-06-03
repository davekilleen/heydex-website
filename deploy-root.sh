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
# Additive/idempotent: it only writes /var/www/heydex/index.html and the named
# image files. It does NOT touch /diff, /connect, or the Caddy config.
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

echo "→ Staging root page + assets on host..."
ssh -i "$SSH_KEY" "$VPS" "mkdir -p /tmp/heydex-root"
scp -i "$SSH_KEY" "$DIR/$ROOT_HTML" "${PHOTOS[@]/#/$DIR/}" "$VPS:/tmp/heydex-root/"

echo "→ Promoting to live (/var/www/heydex/)..."
ssh -i "$SSH_KEY" "$VPS" "\
  sudo cp /tmp/heydex-root/$ROOT_HTML /var/www/heydex/index.html && \
  sudo cp /tmp/heydex-root/*.png /var/www/heydex/ && \
  sudo chown dex:dex /var/www/heydex/index.html && \
  for f in ${PHOTOS[*]}; do sudo chown dex:dex \"/var/www/heydex/\$f\"; done"

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

[ "$fail" = "0" ] && echo "✓ Root marketing page + assets deployed" || { echo "✗ verification failed" >&2; exit 1; }
