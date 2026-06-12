#!/bin/bash
# Deploy the static legal pages (privacy, terms) to the live heydex.ai host.
#
# Additive and safe: it only creates/updates /var/www/heydex/privacy and /terms.
# It does NOT touch /diff, /connect, the site root, or the Caddy config. The
# existing Caddy `file_server` already serves these paths (DESIGN.md lists
# /privacy/ as a static route), so no Caddy change is required.
#
# Usage:  ./deploy-legal.sh
set -e

VPS="ubuntu@57.129.134.24"          # uses your ~/.ssh/config entry (IdentityFile, ControlMaster)
DIR="$(cd "$(dirname "$0")" && pwd)"
LEGAL="$DIR/legal"

echo "→ Staging legal pages on host..."
ssh "$VPS" "mkdir -p /tmp/heydex-legal"
scp "$LEGAL/privacy.html" "$LEGAL/terms.html" "$VPS:/tmp/heydex-legal/"

echo "→ Promoting to live (/var/www/heydex/privacy + /terms)..."
ssh "$VPS" "sudo mkdir -p /var/www/heydex/privacy /var/www/heydex/terms && \
  sudo cp /tmp/heydex-legal/privacy.html /var/www/heydex/privacy/index.html && \
  sudo cp /tmp/heydex-legal/terms.html  /var/www/heydex/terms/index.html && \
  sudo chown -R dex:dex /var/www/heydex/privacy /var/www/heydex/terms"

echo "→ Verifying live URLs..."
for path in privacy terms; do
  code=$(curl -sS -L -o /dev/null -w "%{http_code}" "https://heydex.ai/$path" || echo "ERR")
  echo "  https://heydex.ai/$path → $code"
done

echo "✓ Legal pages deployed to heydex.ai/privacy and heydex.ai/terms"
