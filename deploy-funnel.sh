#!/bin/bash
# Deploy the DexDiff QR funnel web assets to heydex.ai.
#
# Ships exactly two things to the live Caddy host (additive, idempotent):
#   1. /var/www/heydex/install-diff        <- install-diff.sh (the bootstrap)
#      served at  https://heydex.ai/install-diff   (curl ... | bash)
#   2. /var/www/heydex/diff/like-dave/     <- diff/like-dave/index.html
#      served at  https://heydex.ai/diff/like-dave/   (the QR target)
#
# It does NOT touch the React surfaces, the Caddy config, Convex, or the
# database. The Convex side (waitlist endpoint, seedV2 mutations) deploys
# separately via `npm run convex:deploy`, see docs/funnel-go-live-checklist.md
# for the full ordered go-live.
#
# Note: deploy.sh also carries diff/like-dave/ (it is in STATIC_SUBDIRS), but
# nothing else deploys install-diff, this script is the canonical way to ship
# the funnel pair together and verify them.
#
# Usage:  ./deploy-funnel.sh
set -e

VPS="ubuntu@57.129.134.24"
SSH_KEY="$HOME/.ssh/acfs_ed25519"
DIR="$(cd "$(dirname "$0")" && pwd)"

[ -f "$DIR/install-diff.sh" ] || { echo "✗ install-diff.sh missing, run: node scripts/build-install-diff.mjs --skills-root <dex-core>/.claude/skills" >&2; exit 1; }
[ -f "$DIR/diff/like-dave/index.html" ] || { echo "✗ diff/like-dave/index.html missing" >&2; exit 1; }

echo "→ Pre-flight: installer self-test against fixture vaults..."
bash "$DIR/scripts/test-install-diff.sh" >/dev/null && echo "  installer tests pass ✓"

echo "→ Staging on host..."
ssh -i "$SSH_KEY" "$VPS" "mkdir -p /tmp/heydex-funnel/like-dave"
scp -i "$SSH_KEY" "$DIR/install-diff.sh" "$VPS:/tmp/heydex-funnel/install-diff"
scp -i "$SSH_KEY" "$DIR/diff/like-dave/index.html" "$VPS:/tmp/heydex-funnel/like-dave/index.html"

echo "→ Promoting to live..."
ssh -i "$SSH_KEY" "$VPS" "\
  sudo cp /tmp/heydex-funnel/install-diff /var/www/heydex/install-diff && \
  sudo mkdir -p /var/www/heydex/diff/like-dave && \
  sudo cp /tmp/heydex-funnel/like-dave/index.html /var/www/heydex/diff/like-dave/index.html && \
  sudo chown dex:dex /var/www/heydex/install-diff && \
  sudo chown -R dex:dex /var/www/heydex/diff/like-dave"

echo "→ Verifying live..."
fail=0

code=$(curl -sS -o /tmp/heydex-verify-installer -w "%{http_code}" https://heydex.ai/install-diff || echo ERR)
echo "  https://heydex.ai/install-diff → $code"
[ "$code" = "200" ] || fail=1
if head -1 /tmp/heydex-verify-installer | grep -q '^#!/bin/bash'; then
  echo "  installer body looks like a shell script ✓"
else
  echo "  ✗ installer body is not a shell script (Caddy routing problem?)"; fail=1
fi
if diff -q /tmp/heydex-verify-installer "$DIR/install-diff.sh" >/dev/null 2>&1; then
  echo "  live installer is byte-identical to the repo build ✓"
else
  echo "  ✗ live installer differs from repo build"; fail=1
fi

code=$(curl -sS -o /tmp/heydex-verify-likedave -w "%{http_code}" https://heydex.ai/diff/like-dave/ || echo ERR)
echo "  https://heydex.ai/diff/like-dave/ → $code"
[ "$code" = "200" ] || fail=1
if grep -q "Set yourself up" /tmp/heydex-verify-likedave && grep -q "install-diff" /tmp/heydex-verify-likedave; then
  echo "  QR page content present ✓"
else
  echo "  ✗ QR page content missing (React fallback served instead?)"; fail=1
fi

[ "$fail" = "0" ] && echo "✓ Funnel assets deployed" || { echo "✗ verification failed" >&2; exit 1; }
