#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$ROOT_DIR/.env.local" ]]; then
  echo "Missing $ROOT_DIR/.env.local"
  exit 1
fi

set -a
source "$ROOT_DIR/.env.local"
set +a

export VITE_CONVEX_URL="${VITE_CONVEX_URL:-${CONVEX_URL:-}}"

if [[ -z "${VITE_CONVEX_URL:-}" ]]; then
  echo "Missing VITE_CONVEX_URL after loading .env.local"
  exit 1
fi

GATE_PORT="${E2E_GATE_PORT:-3001}"

export VITE_REQUIRE_AUTH=1
export E2E_REQUIRE_AUTH=1
export E2E_REUSE_EXISTING_SERVER="${E2E_REUSE_EXISTING_SERVER:-0}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:$GATE_PORT}"
export E2E_WEB_SERVER_COMMAND="${E2E_WEB_SERVER_COMMAND:-npm run dev -- --host 127.0.0.1 --port $GATE_PORT}"

echo "Running auth-gate Playwright spec against:"
echo "  local app:   $E2E_BASE_URL"
echo "  convex app:  $VITE_CONVEX_URL"

npx playwright test tests/e2e/auth-gate.spec.ts "$@"
