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
    /http\.route\(\{\s*path:\s*"([^"]+)",\s*method:\s*"([^"]+)"/g;
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
