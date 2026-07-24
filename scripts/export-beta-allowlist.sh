#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-$ROOT_DIR/ops/emails-diff.txt}"
RAW_JSON="$(mktemp)"
trap 'rm -f "$RAW_JSON"' EXIT
CONVEX_ARGS=()
if [[ "${BETA_ALLOWLIST_PROD:-0}" == "1" ]]; then
  CONVEX_ARGS+=(--prod)
fi

npx convex run "${CONVEX_ARGS[@]}" beta:exportAllowlist >"$RAW_JSON"
node -e '
  const fs = require("node:fs");
  const input = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!Array.isArray(input) || !input.every((value) => typeof value === "string")) {
    throw new Error("beta:exportAllowlist returned an unexpected payload");
  }
  process.stdout.write([...new Set(input.map((email) => email.trim().toLowerCase()))].sort().join("\n") + "\n");
' "$RAW_JSON" >"$OUTPUT_PATH"

echo "Wrote $OUTPUT_PATH from the Convex betaAllowlist table."
