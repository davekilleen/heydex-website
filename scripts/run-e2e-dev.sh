#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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

if [[ -z "${VITE_CONVEX_URL:-}" ]]; then
  echo "Missing VITE_CONVEX_URL after loading .env.local"
  exit 1
fi

if [[ -z "${E2E_BASE_URL:-}" || -z "${E2E_API_BASE_URL:-}" || -z "${E2E_TEST_SECRET:-}" ]]; then
  echo "Missing one or more E2E vars after loading .env.e2e"
  exit 1
fi

echo "Running Playwright against:"
echo "  local app:   $E2E_BASE_URL"
echo "  hosted API:  $E2E_API_BASE_URL"
echo "  convex app:  $VITE_CONVEX_URL"

npx playwright test "$@"
