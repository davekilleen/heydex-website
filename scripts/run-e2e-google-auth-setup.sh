#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
REMOTE_DEBUG_URL="http://127.0.0.1:9222"
CHROME_PROFILE_DIR="${TMPDIR:-/tmp}/heydex-google-auth-profile"
STARTED_DEV_SERVER=0
STARTED_CHROME=0
DEV_SERVER_PID=""
CHROME_PID=""

cleanup() {
  if [[ "$STARTED_DEV_SERVER" -eq 1 && -n "$DEV_SERVER_PID" ]]; then
    kill "$DEV_SERVER_PID" >/dev/null 2>&1 || true
  fi

  if [[ "$STARTED_CHROME" -eq 1 && -n "$CHROME_PID" ]]; then
    kill "$CHROME_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

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

export VITE_CONVEX_URL="${VITE_CONVEX_URL:-${CONVEX_URL:-}}"
GOOGLE_REDIRECT_URI="${CONVEX_SITE_URL:-}/api/auth/callback/google"
SITE_URL_VALUE="${SITE_URL:-http://127.0.0.1:3000}"
LOCAL_APP_URL="${E2E_BASE_URL:-http://127.0.0.1:3000}"
LOCAL_CONNECT_URL="${LOCAL_APP_URL%/}/connect/?return=/diff/profile/"

if [[ -z "${VITE_CONVEX_URL:-}" ]]; then
  echo "Missing VITE_CONVEX_URL after loading .env.local"
  exit 1
fi

if [[ -z "${E2E_GOOGLE_EMAIL:-}" || -z "${E2E_GOOGLE_PASSWORD:-}" ]]; then
  echo "Missing E2E_GOOGLE_EMAIL or E2E_GOOGLE_PASSWORD"
  exit 1
fi

if [[ ! -x "$CHROME_BIN" ]]; then
  echo "Google Chrome not found at $CHROME_BIN"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for auth bootstrap"
  exit 1
fi

echo "Capturing Google auth state with real Chrome:"
echo "  local app:   $LOCAL_APP_URL"
echo "  convex app:  $VITE_CONVEX_URL"
if [[ -n "${CONVEX_SITE_URL:-}" ]]; then
  echo "  google cb:   $GOOGLE_REDIRECT_URI"
fi
echo "  site url:    $SITE_URL_VALUE"

if [[ "$SITE_URL_VALUE" != "http://127.0.0.1:3000" ]]; then
  echo
  echo "Dev auth bootstrap expects SITE_URL=http://127.0.0.1:3000 on the target Convex deployment."
  echo "Current SITE_URL is: $SITE_URL_VALUE"
  exit 1
fi

if ! curl -sf "$LOCAL_APP_URL" >/dev/null 2>&1; then
  echo
  echo "Starting local Vite dev server..."
  npm run dev -- --host 127.0.0.1 >/tmp/heydex-google-auth-vite.log 2>&1 &
  DEV_SERVER_PID=$!
  STARTED_DEV_SERVER=1

  for _ in {1..30}; do
    if curl -sf "$LOCAL_APP_URL" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl -sf "$LOCAL_APP_URL" >/dev/null 2>&1; then
  echo "Local app did not come up at $LOCAL_APP_URL"
  exit 1
fi

if ! curl -sf "$REMOTE_DEBUG_URL/json/version" >/dev/null 2>&1; then
  echo
  echo "Starting dedicated Chrome for auth bootstrap..."
  mkdir -p "$CHROME_PROFILE_DIR"
  "$CHROME_BIN" \
    --remote-debugging-port=9222 \
    --user-data-dir="$CHROME_PROFILE_DIR" \
    >/tmp/heydex-google-auth-chrome.log 2>&1 &
  CHROME_PID=$!
  STARTED_CHROME=1

  for _ in {1..30}; do
    if curl -sf "$REMOTE_DEBUG_URL/json/version" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl -sf "$REMOTE_DEBUG_URL/json/version" >/dev/null 2>&1; then
  echo "Chrome DevTools endpoint did not come up at $REMOTE_DEBUG_URL"
  exit 1
fi

REMOTE_DEBUG_URL="$REMOTE_DEBUG_URL" E2E_BASE_URL="$LOCAL_APP_URL" \
  node "$ROOT_DIR/scripts/google-auth-setup.mjs"

REMOTE_DEBUG_URL="$REMOTE_DEBUG_URL" \
  node "$ROOT_DIR/scripts/export-google-auth-state.mjs"

echo
echo "Google auth state refreshed."
