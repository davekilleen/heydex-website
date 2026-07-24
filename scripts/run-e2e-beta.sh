#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT_DIR/.env.e2e" ]]; then
  set -a
  source "$ROOT_DIR/.env.e2e"
  set +a
fi
if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  source "$ROOT_DIR/.env.local"
  set +a
fi

: "${E2E_API_BASE_URL:?E2E_API_BASE_URL must target the dedicated test deployment}"
: "${E2E_TEST_SECRET:?E2E_TEST_SECRET is required on the dedicated test deployment}"
export VITE_CONVEX_URL="${VITE_CONVEX_URL:-${CONVEX_URL:-}}"
: "${VITE_CONVEX_URL:?VITE_CONVEX_URL must target the dedicated test deployment}"

if [[ "$E2E_API_BASE_URL" == *"api.heydex.ai"* ]] ||
   [[ "$E2E_API_BASE_URL" == *"gallant-reindeer-229"* ]] ||
   [[ "$VITE_CONVEX_URL" == *"gallant-reindeer-229"* ]]; then
  echo "ABORT: private-beta E2E must never run against DexDiff production." >&2
  exit 1
fi

export E2E_BETA_GATE=1
npx playwright test tests/e2e/beta-gate.spec.ts "$@"
