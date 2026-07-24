#!/usr/bin/env bash
set -euo pipefail

# Dave-run installer for the cosmetic /diff Google gate.
# The real security boundary is the Convex betaAllowlist.
#
# Before running:
# 1. Add https://heydex.ai/oauth2-diff/callback to the Dex Web OAuth client.
# 2. Create ops/oauth2-proxy-diff.cfg locally from the existing desktop config,
#    using port 4182, proxy prefix /oauth2-diff, redirect URL above, and
#    authenticated-emails-file /etc/oauth2-proxy/emails-diff.txt.
# 3. Never commit that cfg: it contains OAuth and cookie secrets.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VPS="${DEXDIFF_GATE_VPS:-ubuntu@57.129.134.24}"
SSH_KEY="${DEXDIFF_GATE_SSH_KEY:-$HOME/.ssh/acfs_ed25519}"
SSH=(ssh -i "$SSH_KEY" "$VPS")

for file in oauth2-proxy-diff.cfg emails-diff.txt oauth2-proxy-diff.service diff-gate.caddy; do
  [ -f "$DIR/$file" ] || { echo "ERROR: $DIR/$file missing"; exit 1; }
done

echo "==> 1/4 Installing oauth2-proxy config, table-derived email snapshot, and service"
scp -i "$SSH_KEY" \
  "$DIR/oauth2-proxy-diff.cfg" \
  "$DIR/emails-diff.txt" \
  "$DIR/oauth2-proxy-diff.service" \
  "$DIR/diff-gate.caddy" \
  "$VPS:/tmp/"
"${SSH[@]}" "
  set -e
  sudo install -m 640 -o root -g oauth2proxy /tmp/oauth2-proxy-diff.cfg /etc/oauth2-proxy/oauth2-proxy-diff.cfg
  sudo install -m 640 -o root -g oauth2proxy /tmp/emails-diff.txt /etc/oauth2-proxy/emails-diff.txt
  sudo install -m 644 /tmp/oauth2-proxy-diff.service /etc/systemd/system/oauth2-proxy-diff.service
  sudo install -m 644 /tmp/diff-gate.caddy /etc/caddy/diff-gate.caddy
  rm -f /tmp/oauth2-proxy-diff.cfg /tmp/emails-diff.txt /tmp/oauth2-proxy-diff.service /tmp/diff-gate.caddy
"

echo "==> 2/4 Starting the DexDiff oauth2-proxy instance"
"${SSH[@]}" "
  set -e
  sudo systemctl daemon-reload
  sudo systemctl enable --now oauth2-proxy-diff
  sudo systemctl is-active oauth2-proxy-diff
"

echo "==> 3/4 Enabling the Caddy import with automatic rollback"
"${SSH[@]}" "
  set -e
  sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.dexdiff-pre-gate
  if ! sudo grep -q '^[[:space:]]*import /etc/caddy/diff-gate.caddy$' /etc/caddy/Caddyfile; then
    sudo grep -q 'import /etc/caddy/desktop-gate.caddy' /etc/caddy/Caddyfile
    sudo sed -i '\|import /etc/caddy/desktop-gate.caddy|a\\timport /etc/caddy/diff-gate.caddy' /etc/caddy/Caddyfile
  fi
  if sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    sudo systemctl reload caddy
  else
    sudo cp /etc/caddy/Caddyfile.dexdiff-pre-gate /etc/caddy/Caddyfile
    sudo systemctl reload caddy
    echo 'VALIDATION FAILED — original Caddyfile restored' >&2
    exit 1
  fi
"

echo "==> 4/4 Verifying anonymous /diff redirects to Google sign-in"
CODE="$(curl -s -o /dev/null -w '%{http_code}' https://heydex.ai/diff/)"
LOCATION="$(curl -s -o /dev/null -w '%{redirect_url}' https://heydex.ai/diff/)"
if [ "$CODE" = "302" ] && [[ "$LOCATION" == *"/oauth2-diff/start"* ]]; then
  echo "DONE: /diff is cosmetically hidden behind Google sign-in."
else
  echo "Unexpected result (HTTP $CODE -> $LOCATION). Rolling Caddy back." >&2
  "${SSH[@]}" "
    sudo cp /etc/caddy/Caddyfile.dexdiff-pre-gate /etc/caddy/Caddyfile
    sudo systemctl reload caddy
  "
  exit 1
fi
