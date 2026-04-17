# Testing

This repo does **not** currently have the full automated suite that earlier docs implied.

Current reality:
- there is no checked-in `test-suite.sh`
- there is no working `npm run test:smoke`
- deploy protection today is `./test-production.sh`
- live route precedence is currently documented in `ops/Caddyfile.heydex`

## What Exists Now

Smoke check:

```bash
./test-production.sh https://heydex.ai
```

Local manual verification:

```bash
npm run convex:dev
npm run dev
```

Then manually verify:
1. `/connect/`
2. `/diff/`
3. `/diff/profile/`
4. `/diff/review/?session=...` loads with a valid session
5. `/diff/@some-random-handle/` cold-loads into React, not a host 404
6. `/diff/@dave/` still shows the static snapshot until cutover
7. sign-in redirect starts correctly
8. registration completes
9. publish redirects to `/diff/@:handle/`

## Playwright E2E Harness

There is now a real browser harness for the DexDiff review flow.

Install browser deps:

```bash
npm run e2e:install
```

Required environment for seeded review-flow tests:

```bash
E2E_BASE_URL=http://127.0.0.1:3000
E2E_API_BASE_URL=https://<your-http-action-host>/api
E2E_TEST_SECRET=<shared-secret-configured-for-convex>
```

Practical rule:

- `.env.local` controls which Convex deployment the local React app talks to
- `.env.e2e` controls which hosted HTTP actions the seeded Playwright tests use
- for seeded E2E, both should point at the same non-production environment

Example `.env.e2e`:

```bash
E2E_BASE_URL=http://127.0.0.1:3000
E2E_API_BASE_URL=https://brave-ibex-877.eu-west-1.convex.site/api
E2E_TEST_SECRET=heydex-e2e-dev-2026-04-10-very-secret
```

Example matching `.env.local`:

```bash
CONVEX_DEPLOYMENT=dev:brave-ibex-877
CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
CONVEX_SITE_URL=https://brave-ibex-877.eu-west-1.convex.site
VITE_CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
```

If `E2E_API_BASE_URL` points at dev but `VITE_CONVEX_URL` points at prod, the seed API and the browser UI will talk to different backends and the public-profile tests will fail in confusing ways.

What the seeded harness covers:
- review page loads from a fresh seeded review session
- inline profile and workflow edits persist across reload
- expired review sessions show the recovery state
- the public CLI contract for `/api/connect/redeem`, `/api/review/create`, and `/api/review/status`
- connection-code rejection for invalid, expired, and already-used codes
- CLI session-token expiry handling for `/api/review/create`
- true CLI link -> browser review -> publish -> public profile flow
- public profile cold-load and browse coverage for non-self handles
- authenticated public-profile adopt/copy coverage for signed-in users
- real-browser authenticated self-profile smoke for `/diff/profile/`
- public publish redirect to `/diff/@:handle/`

Run:

```bash
npm run e2e
```

Recommended wrapper for local dev/staging runs:

```bash
npm run e2e:dev
```

Pass a specific spec through to Playwright in the normal way:

```bash
npm run e2e:dev -- tests/e2e/profile-bundle.spec.ts
```

Useful subsets:

```bash
npx playwright test tests/e2e/review-session.spec.ts
npx playwright test tests/e2e/review-session-expired.spec.ts
npx playwright test tests/e2e/cli-contract.spec.ts
npm run e2e:dev -- tests/e2e/google-auth.spec.ts
npm run e2e:dev -- tests/e2e/public-profile-adopt.spec.ts
npm run e2e:google:setup
npm run e2e:self-profile
```

### Live Google auth automation

The reusable Google smoke now runs against the same real Chrome session used for auth bootstrap.

Bootstrap or refresh that session with a real headed Google sign-in:

```bash
E2E_GOOGLE_EMAIL=...
E2E_GOOGLE_PASSWORD=...
npm run e2e:google:setup
```

Before that, make sure the Google OAuth client allowlist includes the current Convex callback URI:

```bash
npm run e2e:google:redirect-uri
```

That command prints the exact dev callback to add under Google Cloud Console -> OAuth client -> Authorized redirect URIs.

Then run the reusable auth smoke:

```bash
npm run e2e:google
```

Notes:
- use a dedicated Google test identity, not a personal account
- `npm run e2e:google` now reuses the live Chrome session over CDP instead of a Playwright-only restored context
- rerun `npm run e2e:google:setup` whenever the Google session expires or the Chrome profile is reset
- for the current dev deployment, the allowlist entry should be `${CONVEX_SITE_URL}/api/auth/callback/google`
- expect the setup capture to be slower and more brittle than the seeded review-session tests
- keep the seeded session harness as the default coverage; use the real-browser Google smoke on top
- raw credentials are only used by the real-Chrome bootstrap script that refreshes the saved session
- a non-prod auth bypass may still be worth adding if session refresh becomes too fragile

## What Needs To Be Added

### Browser E2E

Needed coverage:
- one deploy-time or CI path for the auth-state refresh itself
- one production-host smoke path for `api.heydex.ai` from an allowed environment

Preferred approach:
- Playwright against a dedicated test deployment
- use a real OAuth-capable test identity or a controlled auth bypass for non-prod only

### CLI Contract Tests

Needed coverage:
- `/api/publish`
- `/api/love-letter`
- authenticated adoption reads after publish

These should assert:
- code expiry
- session token issuance
- session token expiry
- review session creation with valid CLI auth
- publish-side effects after valid CLI auth

Before adding them, resolve the live API base:
- hosted HTTP actions live at `https://api.heydex.ai/api/*`
- the inspected live Caddy config for `heydex.ai` correctly does not expose `/api/*`
- direct API probes from this environment can still hit Cloudflare `1010`, so gate the live smoke behind an explicit opt-in:

```bash
E2E_ALLOW_LIVE_API_SMOKE=1 npm run smoke:api:prod
```

## Test Account Notes

If you add browser E2E later, use a dedicated hosted test identity.

Store creds outside the repo, for example:

```bash
TEST_USER_EMAIL=...
TEST_USER_PASSWORD=...
```

Do not assume the current repo already contains a working automated auth harness.
