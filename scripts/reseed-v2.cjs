#!/usr/bin/env node
/**
 * Re-seed production with the real v2 methodology YAMLs — SAFELY.
 *
 * Modes:
 *   node scripts/reseed-v2.cjs                          DRY RUN (default, no network)
 *   node scripts/reseed-v2.cjs --emit-bundle out.json   build the profile-bundle JSON
 *                                                       a stub server can serve locally
 *   node scripts/reseed-v2.cjs --prod                   WRITE TO PRODUCTION (gated)
 *   node scripts/reseed-v2.cjs --prod --set-visibility public
 *   node scripts/reseed-v2.cjs --prod --archive-legacy dave
 *
 * Production writes require BOTH:
 *   1. the --prod flag
 *   2. RESEED_PRODUCTION=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION in the env
 * Anything less prints the plan and exits without touching anything.
 *
 * Why this replaces scripts/seed-database.cjs for diffs: the legacy script
 * interpolated `methodology="${diff.methodology}"` into a shell string, which
 * cannot carry multi-line YAML — that is how production ended up serving
 * 227-character v1 summaries. This script passes a single JSON argument via
 * execFileSync (argv array, no shell), so the full YAML survives verbatim.
 */

const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SEED_DIR = path.join(REPO_ROOT, "seed-data", "dave-profile-v2");
const MANIFEST_PATH = path.join(SEED_DIR, "manifest.json");

const PROD_ENV_FLAG = "RESEED_PRODUCTION";
const PROD_ENV_VALUE = "I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION";
const BUNDLE_CONTRACT_VERSION = "2026-04-10";

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load + validate the payload (runs in every mode)
// ---------------------------------------------------------------------------
function loadValidatedPayload() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`Manifest not found: ${MANIFEST_PATH} — run scripts/export-profile-v2.py first`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const problems = [];
  const diffs = [];

  for (const entry of manifest.diffs) {
    const filePath = path.join(REPO_ROOT, entry.methodologyFile);
    if (!fs.existsSync(filePath)) {
      problems.push(`${entry.diffId}: missing ${entry.methodologyFile}`);
      continue;
    }
    const methodology = fs.readFileSync(filePath, "utf-8");
    const sha = crypto.createHash("sha256").update(methodology, "utf-8").digest("hex");

    if (sha !== entry.sha256) {
      problems.push(`${entry.diffId}: file changed since export (sha mismatch) — re-run export-profile-v2.py`);
    }
    if (!methodology.includes('dexdiff_schema: "2.0"')) {
      problems.push(`${entry.diffId}: missing dexdiff_schema 2.0 marker`);
    }
    if (!new RegExp(`^id: ${entry.diffId}$`, "m").test(methodology)) {
      problems.push(`${entry.diffId}: YAML id line does not match diffId`);
    }
    if (methodology.includes("/Users/")) {
      problems.push(`${entry.diffId}: contains an absolute /Users/ path`);
    }
    if (methodology.length < 5000) {
      problems.push(`${entry.diffId}: only ${methodology.length} chars — that is v1-summary territory`);
    }

    diffs.push({ ...entry, methodology });
  }

  return { manifest, diffs, problems };
}

function printPlan(manifest, diffs) {
  console.log(`\nTarget user handle : ${manifest.user.handle}`);
  console.log(`Workflows          : ${diffs.length}`);
  console.log("");
  for (const diff of diffs) {
    console.log(
      `  ${diff.diffId.padEnd(28)} ${String(diff.methodology.length).padStart(7)} chars  "${diff.name}"`
    );
  }
  const total = diffs.reduce((sum, diff) => sum + diff.methodology.length, 0);
  console.log(`\n  total methodology payload: ${total.toLocaleString()} chars`);
  console.log(
    "  (production today serves ~230-char v1 summaries — this is the fix for break 3)"
  );
}

// ---------------------------------------------------------------------------
// Bundle emit — exactly the shape api.heydex.ai/api/profile-bundle returns
// (mirrors convex/profiles.ts getBundle) so local stubs serve the real thing
// ---------------------------------------------------------------------------
function emitBundle(manifest, diffs, outPath) {
  const now = Date.now();
  const bundle = {
    contractVersion: BUNDLE_CONTRACT_VERSION,
    profile: {
      handle: manifest.user.handle,
      displayName: manifest.user.displayName,
      role: manifest.user.role,
      title: manifest.user.role,
      company: manifest.user.company,
      function_: manifest.user.function,
      seniority: undefined,
      summary: undefined,
      photoUrl: undefined,
      linkedinUrl: manifest.user.linkedinUrl,
      visibility: "public",
      totalAdoptions: 0,
    },
    workflows: diffs.map((diff) => ({
      diffId: diff.diffId,
      name: diff.name,
      description: diff.description,
      methodology: diff.methodology,
      tags: diff.tags,
      roles: diff.roles,
      integrations: diff.integrations,
      adoptionCount: 0,
      publishedAt: now,
    })),
    loveLetter: null,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`\n✓ Bundle written to ${outPath}`);
  console.log(`  contractVersion ${bundle.contractVersion}, ${bundle.workflows.length} workflows`);
}

// ---------------------------------------------------------------------------
// Production writes (gated)
// ---------------------------------------------------------------------------
function convexRun(functionName, args) {
  const argv = ["convex", "run", functionName, JSON.stringify(args), "--prod"];
  console.log(`  npx convex run ${functionName} … --prod`);
  const output = execFileSync("npx", argv, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 120000,
  });
  console.log(`    ${output.trim().split("\n").join("\n    ")}`);
}

function main() {
  const argv = process.argv.slice(2);
  const prod = argv.includes("--prod");
  const emitIndex = argv.indexOf("--emit-bundle");
  const visibilityIndex = argv.indexOf("--set-visibility");
  const archiveIndex = argv.indexOf("--archive-legacy");

  console.log("DexDiff v2 re-seed");
  console.log("==================");

  const { manifest, diffs, problems } = loadValidatedPayload();
  printPlan(manifest, diffs);

  if (problems.length > 0) {
    console.log("\nVALIDATION PROBLEMS:");
    for (const problem of problems) console.log(`  ! ${problem}`);
    fail("Fix validation problems before doing anything else.");
  }
  console.log("\n✓ All validation gates passed (sha, schema marker, id match, no path leaks, size)");

  if (emitIndex !== -1) {
    const outPath = argv[emitIndex + 1];
    if (!outPath) fail("--emit-bundle needs an output path");
    emitBundle(manifest, diffs, path.resolve(outPath));
    return;
  }

  if (!prod) {
    console.log("\nDRY RUN — nothing was written anywhere.");
    console.log("To write to production:");
    console.log(`  ${PROD_ENV_FLAG}=${PROD_ENV_VALUE} node scripts/reseed-v2.cjs --prod`);
    return;
  }

  // ---- production gate ----
  if (process.env[PROD_ENV_FLAG] !== PROD_ENV_VALUE) {
    fail(
      `--prod refused: set ${PROD_ENV_FLAG}=${PROD_ENV_VALUE} in the environment. ` +
        "This is the explicit two-key gate — the flag alone is not enough."
    );
  }

  if (visibilityIndex !== -1) {
    const visibility = argv[visibilityIndex + 1];
    if (!["private", "colleagues", "public"].includes(visibility)) {
      fail("--set-visibility needs one of: private | colleagues | public");
    }
    console.log(`\nSetting @${manifest.user.handle} visibility to ${visibility}...`);
    convexRun("seedV2:setProfileVisibility", { handle: manifest.user.handle, visibility });
    return;
  }

  if (archiveIndex !== -1) {
    const handle = argv[archiveIndex + 1];
    if (!handle) fail("--archive-legacy needs a handle (the legacy seed handle is: dave)");
    console.log(`\nArchiving published diffs under @${handle}...`);
    convexRun("seedV2:archiveDiffsByHandle", { handle });
    return;
  }

  console.log(`\nSeeding ${diffs.length} workflows under @${manifest.user.handle} (PRODUCTION)...`);
  for (const diff of diffs) {
    convexRun("seedV2:seedProfileDiff", {
      handle: manifest.user.handle,
      diffId: diff.diffId,
      name: diff.name,
      description: diff.description,
      methodology: diff.methodology,
      tags: diff.tags,
      roles: diff.roles,
      integrations: diff.integrations,
    });
  }
  console.log("\n✓ Re-seed complete. Verify with:");
  console.log(
    `  curl -s "https://api.heydex.ai/api/profile-bundle?handle=${manifest.user.handle}" | head -c 600`
  );
}

main();
