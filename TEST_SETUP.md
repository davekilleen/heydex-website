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
```

### Live Google auth automation

The harness now expects a saved Playwright auth state for the dedicated Google test account.

Bootstrap or refresh that state with a real headed Google sign-in:

```bash
E2E_GOOGLE_EMAIL=...
E2E_GOOGLE_PASSWORD=...
npm run e2e:google:setup
```

Optional:

```bash
E2E_GOOGLE_AUTH_STATE_PATH=playwright/.auth/google-test-user.json
```

Then run the reusable auth smoke:

```bash
npm run e2e:google
```

Notes:
- use a dedicated Google test identity, not a personal account
- keep the auth-state file outside git; `playwright/.auth/` is ignored already
- rerun `npm run e2e:google:setup` whenever the Google session expires
- the reusable smoke should use saved session state, not retype credentials
- expect the setup capture to be slower and more brittle than the seeded review-session tests
- keep the seeded session harness as the default coverage; use Google auth as the high-value smoke on top
- raw credentials are still only for refreshing the saved session because Google is returning "This browser or app may not be secure"
- a non-prod auth bypass may still be worth adding if session refresh becomes too fragile

## What Needs To Be Added

### Browser E2E

Needed coverage:
- live Google sign-in smoke that survives Google's browser checks
- registration continuation after Google sign-in on a reusable test identity
- self-profile authenticated coverage
- public-profile adopt coverage for authenticated users, not just browse
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
- direct API probes from this environment currently hit Cloudflare `1010`, so use an allowed environment for API smoke checks

## Test Account Notes

If you add browser E2E later, use a dedicated hosted test identity.

Store creds outside the repo, for example:

```bash
TEST_USER_EMAIL=...
TEST_USER_PASSWORD=...
```

Do not assume the current repo already contains a working automated auth harness.
