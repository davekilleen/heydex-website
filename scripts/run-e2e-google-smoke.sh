#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DEBUG_URL="http://127.0.0.1:9222"
LOCAL_APP_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"

if [[ ! -f "$ROOT_DIR/.env.local" ]]; then
  echo "Missing $ROOT_DIR/.env.local"
  exit 1
fi

if [[ ! -f "$ROOT_DIR/.env.e2e" ]]; then
  echo "Missing $ROOT_DIR/.env.e2e"
  exit 1
fi

set -a
source "$ROOT_DIR/.env.local"
source "$ROOT_DIR/.env.e2e"
set +a

if ! curl -sf "$LOCAL_APP_URL" >/dev/null 2>&1; then
  echo "Local app is not reachable at $LOCAL_APP_URL"
  exit 1
fi

if ! curl -sf "$REMOTE_DEBUG_URL/json/version" >/dev/null 2>&1; then
  echo "Chrome DevTools endpoint is not reachable at $REMOTE_DEBUG_URL"
  echo "Run npm run e2e:google:setup first."
  exit 1
fi

echo "Verifying Google auth smoke against:"
echo "  local app:    $LOCAL_APP_URL"
echo "  remote debug: $REMOTE_DEBUG_URL"
echo "  requires:     npm run e2e:google:setup"

REMOTE_DEBUG_URL="$REMOTE_DEBUG_URL" E2E_BASE_URL="$LOCAL_APP_URL" \
  node "$ROOT_DIR/scripts/google-auth-smoke.mjs"

echo "✅ Google auth smoke passed"
