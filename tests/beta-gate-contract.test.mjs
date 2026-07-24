import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const HTTP_ROUTE_POLICIES = new Map([
  ["GET /api/diff", "beta"],
  ["GET /api/profile", "beta"],
  ["GET /api/profile-bundle", "beta"],
  ["POST /api/profile-bundle/redeem", "beta"],
  ["GET /api/diffs", "beta"],
  ["POST /api/adoptions", "beta"],
  ["POST /api/connect/redeem", "beta"],
  ["POST /api/review/create", "beta"],
  ["GET /api/review/status", "beta"],
  ["POST /api/test/bootstrap-cli", "test"],
  ["POST /api/test/bootstrap-connect-code", "test"],
  ["POST /api/test/bootstrap-review", "test"],
  ["POST /api/test/bootstrap-public-profile", "test"],
  ["POST /api/test/bootstrap-auth", "test"],
  ["POST /api/test/bootstrap-company-domain", "test"],
  ["GET /api/test/company", "test"],
  ["GET /api/test/diffs", "test"],
  ["POST /api/test/bootstrap-adoption", "test"],
  ["POST /api/test/bootstrap-adopt-grant", "test"],
  ["POST /api/test/set-beta-email", "test"],
  ["POST /api/test/remove-beta-email", "test"],
  ["POST /api/publish", "beta"],
  ["POST /api/love-letter", "beta"],
  ["GET /api/love-letters", "beta"],
  ["OPTIONS /api/love-letter", "cors"],
  ["OPTIONS /api/love-letters", "cors"],
  ["OPTIONS /api/connect/redeem", "cors"],
  ["OPTIONS /api/publish", "cors"],
  ["OPTIONS /api/review/create", "cors"],
  ["OPTIONS /api/adoptions", "cors"],
  ["OPTIONS /api/profile-bundle/redeem", "cors"],
  ["OPTIONS /api/test/bootstrap-cli", "cors"],
  ["OPTIONS /api/test/bootstrap-connect-code", "cors"],
  ["OPTIONS /api/test/bootstrap-review", "cors"],
  ["OPTIONS /api/test/bootstrap-public-profile", "cors"],
  ["OPTIONS /api/test/bootstrap-adopt-grant", "cors"],
  ["OPTIONS /api/test/remove-beta-email", "cors"],
  ["POST /api/waitlist", "open"],
  ["OPTIONS /api/waitlist", "cors"],
]);

test("every explicit HTTP route is classified exhaustively", () => {
  const source = read("convex/http.ts");
  const routePattern =
    /(?:http\.route|registerTestRoute)\(\{\s*path:\s*"([^"]+)",\s*method:\s*"([^"]+)"/g;
  const actual = [...source.matchAll(routePattern)].map(
    ([, path, method]) => `${method} ${path}`,
  );

  assert.equal(actual.length, HTTP_ROUTE_POLICIES.size);
  assert.deepEqual(new Set(actual), new Set(HTTP_ROUTE_POLICIES.keys()));
});

test("beta authorization has one normalized table-backed primitive and rollback flag", () => {
  const schema = read("convex/schema.ts");
  const helper = read("convex/lib/beta.ts");

  assert.match(schema, /betaAllowlist:\s*defineTable/);
  assert.match(schema, /\.index\("by_email", \["email"\]\)/);
  assert.match(helper, /export async function requireBetaViewer/);
  assert.match(helper, /export async function requireBetaUser/);
  assert.match(helper, /toLowerCase\(\)/);
  assert.match(helper, /process\.env\.BETA_GATE/);
  assert.match(helper, /=== "off"/);
  assert.match(helper, /console\.warn\([^)]*BETA_GATE=off/s);
});

test("test routes and harness functions are structurally disabled in production", () => {
  const http = read("convex/http.ts");
  const harness = read("convex/testHarness.ts");
  const environment = read("convex/lib/environment.js");
  const releaseGate = read("scripts/check-production-convex-env.sh");

  assert.match(
    environment,
    /process\.env\.CONVEX_ENV\?\.trim\(\)\.toLowerCase\(\) === "prod"/,
  );
  assert.match(
    environment,
    /process\.env\.CONVEX_ENV\?\.trim\(\)\.toLowerCase\(\) === "test"/,
  );
  assert.match(http, /function registerTestRoute/);
  assert.match(http, /if \(!isTestHarnessEnvironment\(\)\)/);
  assert.match(http, /registerTestRoute\(\{\s*path:\s*"\/api\/test\//);
  assert.doesNotMatch(http, /http\.route\(\{\s*path:\s*"\/api\/test\//);
  assert.match(harness, /function assertTestHarnessAvailable/);

  const harnessExports = [...harness.matchAll(
    /export const \w+ = internal(?:Mutation|Query)\(\{([\s\S]*?)(?=\n\}\);\n)/g,
  )];
  assert.ok(harnessExports.length > 0, "expected internal test harness functions");
  for (const [, block] of harnessExports) {
    assert.match(block, /handler:\s*async[\s\S]*?assertTestHarnessAvailable\(\)/);
  }

  assert.doesNotMatch(harness, /betaAllowlist/);
  assert.doesNotMatch(harness, /betaAllowed/);
  assert.match(releaseGate, /CONVEX_ENV=prod/);
  assert.match(releaseGate, /E2E_TEST_SECRET/);
});

test("connection code redemption is internal-only and codes are widened", () => {
  const source = read("convex/connect.ts");
  const http = read("convex/http.ts");

  assert.match(source, /export const redeemCode = internalMutation/);
  assert.doesNotMatch(source, /export const redeemCode = mutation/);
  assert.doesNotMatch(source, /redeemCodeForHttp/);
  assert.match(http, /internal\.connect\.redeemCode/);
  assert.match(source, /generateSecureCode\([^,]+,\s*10\)/);

  const helperStart = http.indexOf("async function redeemCodeForHttp");
  const helperEnd = http.indexOf("function authorizeTestHarness", helperStart);
  assert.match(http.slice(helperStart, helperEnd), /checkRateLimit\(ip\)/);
  const redemptionCalls = [
    ...http.matchAll(/redeemCodeForHttp\(ctx,\s*code,\s*ip\)/g),
  ];
  assert.equal(redemptionCalls.length, 3);
});

test("review sessions accept only a CLI session token or an authenticated viewer", () => {
  const review = read("convex/review.ts");
  const http = read("convex/http.ts");
  const createSessionStart = review.indexOf("export const createSession");
  const createSessionEnd = review.indexOf(
    "export const createLoveLetterSession",
    createSessionStart,
  );
  const createSession = review.slice(createSessionStart, createSessionEnd);
  const routeStart = http.indexOf('path: "/api/review/create"');
  const routeEnd = http.indexOf("// GET /api/review/status", routeStart);
  const route = http.slice(routeStart, routeEnd);

  assert.doesNotMatch(createSession, /tokenIdentifier/);
  assert.match(createSession, /requireViewerForMutation\(ctx\)/);
  assert.match(createSession, /requireBetaUser\(ctx,\s*user\._id\)/);
  assert.doesNotMatch(route, /tokenIdentifier/);
  assert.match(route, /if \(!sessionToken \|\| !diffs\)/);
});

test("profile grant redemption requires and matches an allowlisted recipient", () => {
  const schema = read("convex/schema.ts");
  const adopt = read("convex/adopt.ts");
  const http = read("convex/http.ts");
  const profiles = read("convex/profiles.ts");

  assert.match(
    schema,
    /adoptGrants:[\s\S]*recipientUserId:\s*v\.optional\(v\.id\("users"\)\)/,
  );
  assert.match(adopt, /recipientUserId:\s*viewer\.userId/);
  assert.match(adopt, /recipientUserId:\s*v\.id\("users"\)/);
  assert.match(adopt, /grant\.recipientUserId !== args\.recipientUserId/);
  assert.match(adopt, /requireBetaUser\(ctx,\s*args\.recipientUserId\)/);
  assert.match(adopt, /internal\.profiles\.getBundleForBetaUser/);
  assert.doesNotMatch(adopt, /getBundleUnchecked/);
  assert.doesNotMatch(profiles, /export const getBundleUnchecked/);

  const routeStart = http.indexOf('path: "/api/profile-bundle/redeem"');
  const routeEnd = http.indexOf("// GET /api/diffs", routeStart);
  const route = http.slice(routeStart, routeEnd);
  assert.match(route, /resolveRequiredHttpBetaUser\(ctx,\s*req\)/);
  assert.match(route, /recipientUserId:\s*betaAccess\.user\._id/);
});

test("security-sensitive codes use crypto randomness at required lengths", () => {
  const random = read("convex/lib/random.js");
  const adopt = read("convex/adopt.ts");
  const connect = read("convex/connect.ts");
  const review = read("convex/review.ts");

  assert.match(random, /crypto\.getRandomValues/);
  assert.doesNotMatch(adopt + connect + review, /Math\.random/);
  assert.match(adopt, /generateSecureCode\([^,]+,\s*16\)/);
  assert.match(connect, /generateSecureCode\([^,]+,\s*10\)/);
  assert.match(review, /generateSecureCode\([^,]+,\s*16\)/);
});

test("publishViaCode is internal and bound to immutable userId", () => {
  const source = read("convex/diffs.ts");
  const block = source.slice(
    source.indexOf("export const publishViaCode"),
    source.indexOf("export const publish =", source.indexOf("export const publishViaCode")),
  );

  assert.match(block, /publishViaCode = internalMutation/);
  assert.match(block, /userId:\s*v\.id\("users"\)/);
  assert.doesNotMatch(block, /userHandle:\s*v\.string/);
  assert.match(block, /requireBetaUser\(ctx,\s*args\.userId\)/);
});

test("all content and write chokepoints invoke beta authorization", () => {
  const requiredCalls = {
    "convex/diffs.ts": [
      "requireBetaViewer(ctx)",
      "requireBetaUser(ctx, args.userId)",
    ],
    "convex/profiles.ts": ["requireBetaViewer(ctx)"],
    "convex/connect.ts": [
      "requireBetaViewer(ctx)",
      "requireBetaUser(ctx, codeDoc.userId)",
      "requireBetaUser(ctx, session.userId)",
    ],
    "convex/review.ts": [
      "requireBetaUser(ctx, user._id)",
      "requireBetaUser(ctx, session.userId)",
      "requireBetaViewer(ctx)",
    ],
    "convex/users.ts": ["requireBetaViewer(ctx)"],
    "convex/adoptions.ts": ["requireBetaViewer(ctx)"],
    "convex/loveLetters.ts": ["requireBetaViewer(ctx)"],
    "convex/companies.ts": ["requireBetaViewer(ctx)"],
    "convex/adopt.ts": [
      "requireBetaViewer(ctx)",
      "requireBetaUser(ctx, grant.granterUserId)",
    ],
  };

  for (const [path, snippets] of Object.entries(requiredCalls)) {
    const source = read(path);
    for (const snippet of snippets) {
      assert.ok(source.includes(snippet), `${path} must include ${snippet}`);
    }
  }
});

test("allowlist removal invalidates CLI and review sessions", () => {
  const source = read("convex/beta.ts");
  assert.match(source, /export const removeEmail = mutation/);
  assert.match(source, /query\("cliSessions"\)/);
  assert.match(source, /query\("reviewSessions"\)/);
  assert.match(source, /ctx\.db\.delete/);
});

test("the six approved emails are seeded and cosmetic export is generated", () => {
  const source = read("convex/beta.ts");
  const exported = read("ops/emails-diff.txt");
  const expected = [
    "davekilleen@gmail.com",
    "dave.killeen@pendo.io",
    "sam.jefferies@pendo.io",
    "laurence.judah@pendo.io",
    "matt@mattlemay.com",
    "martin@martineriksson.com",
  ];

  for (const email of expected) {
    assert.ok(source.includes(email), `seed is missing ${email}`);
    assert.ok(exported.split(/\r?\n/).includes(email), `export is missing ${email}`);
  }
});

test("production release gate rejects E2E_TEST_SECRET and E2E targets prod", () => {
  const releaseGate = read("scripts/check-production-convex-env.sh");
  const deploy = read("deploy.sh");
  const ci = read(".github/workflows/ci.yml");

  assert.match(releaseGate, /E2E_TEST_SECRET/);
  assert.match(releaseGate, /gallant-reindeer-229/);
  assert.match(deploy, /check-production-convex-env\.sh/);
  assert.match(ci, /convex env set CONVEX_ENV test/);
  assert.match(ci, /brave-ibex-877/);
  assert.doesNotMatch(ci, /CONVEX_DEPLOY_KEY_PROD/);
});

test("deploy smoke expects OAuth redirects for gated Diff routes", () => {
  const source = read("test-production.sh");
  assert.match(source, /oauth2-diff\/start/);
  assert.match(source, /302/);
  assert.doesNotMatch(source, /curl -sf "\$BASE_URL\/diff\//);
});

test("Caddy assets and gated-out UX are present without secrets", () => {
  const caddy = read("ops/diff-gate.caddy");
  const installer = read("ops/setup-diff-google-gate.sh");
  const diffPage = read("src/pages/DiffPage.jsx");
  const connectPage = read("src/pages/ConnectPage.jsx");

  assert.match(caddy, /forward_auth/);
  assert.match(installer, /oauth2-proxy/);
  assert.doesNotMatch(caddy + installer, /client_secret\s+\S+/i);
  assert.match(diffPage, /not in the beta yet/i);
  assert.match(connectPage, /not in the beta yet/i);
});
