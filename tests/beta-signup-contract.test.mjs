import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

function source(path) {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

test('the React app owns both beta route spellings', () => {
  const app = source('src/App.jsx');

  assert.match(app, /import BetaPage from ['"]\.\/pages\/BetaPage['"]/);
  assert.match(app, /path="\/beta"/);
  assert.match(app, /path="\/beta\/"/);
});

test('the beta page exposes the required signed-out, questionnaire, and revisit states', () => {
  const page = source('src/pages/BetaPage.jsx');

  assert.match(page, /Continue with Google/);
  assert.doesNotMatch(page, /Continue with Microsoft|Continue with Apple/);
  assert.match(page, /api\.enrichment\.enrichProfile/);
  assert.match(page, /api\.betaSignups\.mine/);
  assert.match(page, /api\.betaSignups\.submit/);
  assert.match(page, /Request beta access/);
  assert.match(page, /You(?:'|&apos;)re on the list/);
  assert.match(page, /Update my answers/);
  assert.match(
    page,
    /linkedinUrl:\s*linkedinConfirmed\s*\?\s*enriched\?\.linkedinUrl\s*:\s*undefined/,
  );
});

test('Convex stores one authenticated beta signup per user and schedules confirmation', () => {
  const schema = source('convex/schema.ts');
  const backend = source('convex/betaSignups.ts');

  assert.match(schema, /betaSignups:\s*defineTable/);
  assert.match(schema, /\.index\("by_userId", \["userId"\]\)/);
  assert.match(schema, /\.index\("by_email", \["email"\]\)/);
  assert.match(backend, /requireViewerForMutation/);
  assert.match(backend, /export const mine = query/);
  assert.match(backend, /export const submit = mutation/);
  assert.match(backend, /internal\.betaSignups\.sendConfirmation/);
  assert.match(backend, /export const sendConfirmation = internalAction/);
  assert.match(backend, /confirmationEmailSent/);
  assert.match(backend, /You're on the Dex beta list/);
});

test('account deletion removes stored beta questionnaire and LinkedIn data', () => {
  const users = source('convex/users.ts');
  const cleanupCalls = users.match(/deleteBetaSignupsForUser\(ctx, user\._id\)/g);

  assert.equal(
    cleanupCalls?.length,
    2,
    'both admin cleanup and self-service account deletion remove beta signup PII',
  );
});

test('Caddy and deploy plumbing serve a route-scoped beta SPA from the DexDiff build', () => {
  const caddy = source('ops/Caddyfile.heydex');
  const deploy = source('deploy.sh');

  assert.match(caddy, /redir \/beta \/beta\/ 308/);
  assert.match(caddy, /@beta\s*\{[\s\S]*?path \/beta \/beta\/\*/);
  assert.match(caddy, /root \* \/var\/www\/heydex\/beta/);
  assert.match(deploy, /TMP_BETA=.*mktemp -d \/tmp\/heydex-beta/);
  assert.match(deploy, /LIVE_BETA="\/var\/www\/heydex\/beta\/"/);
  assert.match(deploy, /<base href=\\"\/beta\/\\">|"\$TMP_BETA\/index\.html" "\/beta\/"/);
  assert.match(deploy, /"\$TMP_BETA\/" "\$VPS:\$STAGING\/beta\/"/);
});
