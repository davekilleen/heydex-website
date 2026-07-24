#!/bin/bash
# Deploy heydex-website React app to the live Caddy host
# Usage: ./deploy.sh [--dry-run] [--skip-tests]

set -e

echo "🔒 Checking production Convex test-harness safety..."
./scripts/check-production-convex-env.sh
echo ""

# Run smoke tests before deploying (unless --skip-tests)
if [[ "$1" != "--skip-tests" ]] && [[ "$2" != "--skip-tests" ]]; then
  echo "🧪 Running pre-deploy tests..."
  ./test-production.sh https://heydex.ai
  echo ""
fi

VPS="ubuntu@57.129.134.24"
SSH_KEY="~/.ssh/acfs_ed25519"
TMP_DIFF="$(mktemp -d /tmp/heydex-diff.XXXXXX)"
TMP_CONNECT="$(mktemp -d /tmp/heydex-connect.XXXXXX)"
TMP_DESKTOP="$(mktemp -d /tmp/heydex-desktop.XXXXXX)"
STAGING="/tmp/heydex-deploy/"
LIVE_DIFF="/var/www/heydex/diff/"
LIVE_CONNECT="/var/www/heydex/connect/"
LIVE_DESKTOP="/var/www/heydex/desktop/"
DESKTOP_HELP_SITE="${DESKTOP_HELP_SITE:-$(dirname "$0")/../dex-desktop-concierge/help/site/}"
DESKTOP_HELP_SITE="${DESKTOP_HELP_SITE%/}/"
DIFF_CONVEX_URL="${DIFF_CONVEX_URL:-https://gallant-reindeer-229.eu-west-1.convex.cloud}"
DESKTOP_CONVEX_URL="${DESKTOP_CONVEX_URL:-https://focused-mouse-723.eu-west-1.convex.cloud}"
DIFF_REQUIRE_AUTH="${VITE_REQUIRE_AUTH:-1}"
DIFF_AUTH_PROVIDERS="${DIFF_AUTH_PROVIDERS:-google}"

# The live route precedence is defined by Caddy on the host and mirrored in
# ops/Caddyfile.heydex. This script only updates the static assets under those roots.
#
# Caddy config is NOT auto-deployed from this repo. Drift between the live
# /etc/caddy/Caddyfile and ops/Caddyfile.heydex is detected (read-only) by
# scripts/check-caddy-drift.sh, which runs as an advisory warning inside
# test-production.sh. ops/Caddyfile.heydex is the source of truth; if the
# drift check fires, reconcile manually on the host before treating the Caddy
# contract as accurate.
#
# The React app is deployed as three route-scoped copies, but those copies do
# not all talk to the same Convex deployment. DexDiff routes (/diff and
# /connect) use gallant-reindeer-229 (project heydex-web, PROD; dev is
# bright-sandpiper-976). The desktop beta portal (/desktop) uses focused-mouse-723.
# Build each backend target independently so Vite bakes the right Convex URL
# into each bundle. The DexDiff build also carries the temporary auth gate
# flag and the Google-only sign-in flag; the desktop build does not.

cleanup() {
  rm -rf "$TMP_DIFF" "$TMP_CONNECT" "$TMP_DESKTOP"
}
trap cleanup EXIT

echo "🏗️ Building DexDiff React app..."
(
  export VITE_CONVEX_URL="$DIFF_CONVEX_URL"
  export VITE_REQUIRE_AUTH="$DIFF_REQUIRE_AUTH"
  export VITE_AUTH_PROVIDERS="$DIFF_AUTH_PROVIDERS"
  npm run build
)
cp -R dist/. "$TMP_DIFF/"
cp -R dist/. "$TMP_CONNECT/"
echo ""

echo "🏗️ Building desktop React app..."
(
  unset VITE_REQUIRE_AUTH
  export VITE_CONVEX_URL="$DESKTOP_CONVEX_URL"
  npm run build
)
cp -R dist/. "$TMP_DESKTOP/"
echo ""

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

# Tripwires: a bundle baked with the wrong Convex deployment is a silent prod
# outage. Reject every known-wrong URL and require the right one to be present.
for wrong in focused-mouse-723 brave-ibex-877 bright-sandpiper-976; do
  if grep -rqs "$wrong" "$TMP_DIFF"; then
    echo "ABORT: diff copy references the wrong Convex deployment ($wrong)." >&2
    exit 1
  fi
  if grep -rqs "$wrong" "$TMP_CONNECT"; then
    echo "ABORT: connect copy references the wrong Convex deployment ($wrong)." >&2
    exit 1
  fi
done

if ! grep -rqs "gallant-reindeer-229" "$TMP_DIFF"; then
  echo "ABORT: diff copy does not reference the DexDiff prod deployment (gallant-reindeer-229)." >&2
  exit 1
fi

if ! grep -rqs "gallant-reindeer-229" "$TMP_CONNECT"; then
  echo "ABORT: connect copy does not reference the DexDiff prod deployment (gallant-reindeer-229)." >&2
  exit 1
fi

for wrong in brave-ibex-877 bright-sandpiper-976 gallant-reindeer-229; do
  if grep -rqs "$wrong" "$TMP_DESKTOP"; then
    echo "ABORT: desktop copy references a DexDiff Convex deployment ($wrong)." >&2
    exit 1
  fi
done

if [ "$1" = "--dry-run" ]; then
  echo "=== DRY RUN ==="
  rsync -avzn --delete -e "ssh -i $SSH_KEY" "$TMP_DIFF/" "$VPS:$STAGING/diff/"
  rsync -avzn --delete -e "ssh -i $SSH_KEY" "$TMP_CONNECT/" "$VPS:$STAGING/connect/"
  rsync -avzn --delete -e "ssh -i $SSH_KEY" "$TMP_DESKTOP/" "$VPS:$STAGING/desktop/"
  exit 0
fi

if [ ! -d "$DESKTOP_HELP_SITE" ]; then
  echo "Desktop help site not found at $DESKTOP_HELP_SITE"
  echo "Set DESKTOP_HELP_SITE to the built help/site directory before deploying."
  exit 1
fi

echo "→ Syncing to staging..."
ssh -i "$SSH_KEY" "$VPS" "mkdir -p \"$STAGING/diff\" \"$STAGING/connect\" \"$STAGING/desktop/help\""   # ensure staging dirs exist (rsync won't create missing parents)
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_DIFF/" "$VPS:$STAGING/diff/"
rsync -avz --delete -e "ssh -i $SSH_KEY" "$TMP_CONNECT/" "$VPS:$STAGING/connect/"
rsync -avz --delete --chmod=u=rwX,go=rX -e "ssh -i $SSH_KEY" "$TMP_DESKTOP/" "$VPS:$STAGING/desktop/"
rsync -avz --delete --chmod=u=rwX,go=rX -e "ssh -i $SSH_KEY" "$DESKTOP_HELP_SITE" "$VPS:$STAGING/desktop/help/"

echo "→ Promoting to live..."
ssh -i "$SSH_KEY" "$VPS" "sudo rm -rf ${LIVE_DIFF}* ${LIVE_CONNECT}* && sudo cp -r $STAGING/diff/* $LIVE_DIFF && sudo cp -r $STAGING/connect/* $LIVE_CONNECT && sudo chown -R dex:dex $LIVE_DIFF $LIVE_CONNECT"
# The desktop promote uses --delete, so every durable directory that lives under
# /desktop but is NOT part of this build must be excluded or it gets wiped:
#   downloads/  beta DMG installers (shipped separately, DESKTOP_DMG=...)
#   updates/    electron-updater feed (latest-mac.yml + zips) — deleting this
#               breaks auto-update for every installed copy of Dex
#   preview/    ad-hoc preview builds published outside this script
ssh -i "$SSH_KEY" "$VPS" "sudo mkdir -p $LIVE_DESKTOP && sudo rsync -a --delete --exclude downloads/ --exclude updates/ --exclude preview/ $STAGING/desktop/ $LIVE_DESKTOP && sudo chmod 755 $LIVE_DESKTOP && sudo chown -R dex:dex $LIVE_DESKTOP"

# Beta DMG: ship the installer through the same staging pipeline when provided.
# Usage: DESKTOP_DMG=~/Downloads/Dex-arm64.dmg ./deploy.sh
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
STATIC_SUBDIRS="community love-letters roadmap welcome admin like-dave"
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
