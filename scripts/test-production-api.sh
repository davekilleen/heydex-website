#!/usr/bin/env bash
set -euo pipefail

API_HOST="${1:-${E2E_PROD_API_HOST:-https://api.heydex.ai}}"
ALLOW_LIVE_SMOKE="${E2E_ALLOW_LIVE_API_SMOKE:-0}"

if [[ "$ALLOW_LIVE_SMOKE" != "1" ]]; then
  echo "Skipping live api.heydex.ai smoke."
  echo "Set E2E_ALLOW_LIVE_API_SMOKE=1 from an allowed environment to run it."
  exit 0
fi

fetch_and_assert() {
  local url="$1"
  local label="$2"
  local tmp_body
  tmp_body="$(mktemp)"

  local status
  status="$(curl -sS -o "$tmp_body" -w "%{http_code}" "$url")"
  local body
  body="$(<"$tmp_body")"
  rm -f "$tmp_body"

  if [[ "$status" != "200" ]]; then
    echo "❌ $label failed with HTTP $status"
    echo "$body"
    exit 1
  fi

  if [[ "$body" == *"error code: 1010"* ]] || [[ "$body" == *"Access denied"* ]]; then
    echo "❌ $label was blocked by Cloudflare"
    echo "$body"
    exit 1
  fi

  if [[ "$body" != \[* ]] && [[ "$body" != \{* ]]; then
    echo "❌ $label did not return JSON"
    echo "$body"
    exit 1
  fi

  echo "✅ $label OK"
}

echo "Testing live API host: $API_HOST"
fetch_and_assert "$API_HOST/.well-known/openid-configuration" "openid config"
fetch_and_assert "$API_HOST/api/diffs" "public diffs"
fetch_and_assert "$API_HOST/api/love-letters?limit=1" "public love letters"
echo "✅ Live api.heydex.ai smoke passed"
