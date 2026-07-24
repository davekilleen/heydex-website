#!/usr/bin/env bash
set -euo pipefail

PROD_DEPLOYMENT="${DEXDIFF_PROD_CONVEX_DEPLOYMENT:-prod:gallant-reindeer-229}"

echo "Checking DexDiff production Convex environment ($PROD_DEPLOYMENT)..."
ENV_LIST="$(
  CONVEX_DEPLOYMENT="$PROD_DEPLOYMENT" npx convex env list --prod
)"

if grep -q '^E2E_TEST_SECRET=' <<<"$ENV_LIST"; then
  echo "ABORT: E2E_TEST_SECRET is set on the DexDiff production deployment." >&2
  echo "The test bootstrap routes can mint users, sessions, and content; remove the variable before release." >&2
  exit 1
fi

echo "OK: E2E_TEST_SECRET is unset on DexDiff production."
