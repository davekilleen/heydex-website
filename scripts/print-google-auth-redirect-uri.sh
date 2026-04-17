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

if [[ -z "${CONVEX_SITE_URL:-}" ]]; then
  echo "Missing CONVEX_SITE_URL after loading .env.local"
  exit 1
fi

printf '%s/api/auth/callback/google\n' "${CONVEX_SITE_URL%/}"
