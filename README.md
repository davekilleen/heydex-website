# heydex-website

Hosted web + backend home for `heydex.ai`.

This repo owns the DexDiff hosted contract:
- browser auth and registration
- Dex Pi linking
- review sessions and publish
- public profiles and public diff browse
- adoption metadata APIs

It does **not** own the long-term portable `/diff-*` command runtime. That belongs in `dex-core`. `dex-pi` is reference material for the current Dex Pi bridge, not the final runtime owner.

## Canonical Surfaces

React-owned routes:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@:handle/`

Static/editorial routes still served from repo HTML:
- `/`
- `/privacy/`
- `/diff/community/`
- `/diff/company/`
- `/diff/love-letters/`
- `/diff/roadmap/`
- `/diff/welcome/`
- `/diff/admin/`
- `/diff/@dave/` snapshot

Read `docs/ROUTES.md` before changing route ownership.

## Actual Architecture

Frontend:
- Vite + React app mounted from `index.html`
- Browser router handles the exact product paths above
- unknown paths intentionally render nothing so static surfaces can own them
- live edge routing is Caddy, mirrored in `ops/Caddyfile.heydex`

Backend:
- Convex auth + database in `convex/`
- browser auth uses hosted OAuth providers
- the website lives on `https://heydex.ai`
- Convex HTTP actions are exposed on `https://api.heydex.ai`
- Dex Pi auth uses `https://api.heydex.ai/api/connect/redeem` to exchange a short sign-in code for a **session token**
- Dex Pi review publish uses that session token via `https://api.heydex.ai/api/review/create`

Identity model:
- Convex `tokenIdentifier` remains the canonical backend identity key
- CLI clients no longer carry raw `tokenIdentifier`
- mutations now resolve the viewer from server-side auth and sync `tokenIdentifier` on the stored user record when needed

Read `docs/ARCHITECTURE.md` for the end-to-end flow.

## Development

Prereqs:
- Node 18+
- npm

Env:

```bash
VITE_CONVEX_URL=https://<your-convex-deployment>.convex.cloud
CONVEX_DEPLOYMENT=dev:<your-deployment-name>
CONVEX_URL=https://<your-convex-deployment>.convex.cloud
CONVEX_SITE_URL=https://<your-convex-site>.convex.site
```

Recommended local setup:

- `.env.local` is for normal local development
- point it at the dev Convex deployment, not production

Example:

```bash
CONVEX_DEPLOYMENT=dev:brave-ibex-877
CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
CONVEX_SITE_URL=https://brave-ibex-877.eu-west-1.convex.site
VITE_CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
```

Do not point local Vite at production unless you explicitly want to test against live data.

Run:

```bash
npm install
npm run convex:dev
npm run dev
```

Vite runs on `http://localhost:3000`.

## Deploy

Hosted backend:

```bash
npm run convex:deploy
```

Hosted frontend routes on the VPS:

```bash
./deploy.sh
./deploy.sh --dry-run
./deploy.sh --skip-tests
```

What `deploy.sh` actually does:
1. Runs `./test-production.sh` unless skipped
2. Builds the React app
3. Creates separate `/diff/` and `/connect/` copies with route-scoped `<base href>` values
4. Rsyncs those builds to staging
5. Promotes the built app into both `/diff/` and `/connect/`
6. Overlays the static editorial subdirectories listed in `deploy.sh`
7. Runs `npm run db:ensure`

It does **not** deploy the root marketing landing.

The live edge host is currently `ubuntu@57.129.134.24`.

The checked-in mirror of the live route precedence is:

```text
ops/Caddyfile.heydex
```

Read `docs/DEPLOYMENT.md` before touching deploy behavior.

## Validation

Quick hosted smoke check:

```bash
./test-production.sh https://heydex.ai
```

This currently verifies:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@route-smoke/`

`TEST_SETUP.md` covers the real remaining gaps.

Allowed-environment API host smoke:

```bash
E2E_ALLOW_LIVE_API_SMOKE=1 npm run smoke:api:prod
```

That path is intentionally opt-in because direct probes to `api.heydex.ai` can still be blocked by Cloudflare from untrusted environments.

Browser E2E harness:

```bash
npm run e2e:install
npm run e2e
```

The seeded Playwright flow expects:
- `E2E_BASE_URL`
- `E2E_API_BASE_URL`
- `E2E_TEST_SECRET`

The optional live Google auth smoke also expects:
- `E2E_GOOGLE_EMAIL`
- `E2E_GOOGLE_PASSWORD`
- optional `E2E_GOOGLE_AUTH_STATE_PATH`

Google auth note:
- the hosted website should use the web OAuth client via `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`
- do not point hosted Convex Auth at the desktop OAuth client; that client has no redirect URI allowlist and will break browser sign-in

Refresh the saved Google auth session:

```bash
npm run e2e:google:redirect-uri
npm run e2e:google:setup
```

Run the reusable Google auth smoke:

```bash
npm run e2e:google
```

## Important Files

- `src/App.jsx` - canonical React route map
- `src/pages/ConnectPage.jsx` - web auth + CLI linking UI
- `src/pages/ReviewPage.jsx` - review/publish flow
- `src/pages/PublicProfilePage.jsx` - dynamic public profile route
- `convex/connect.ts` - code exchange + CLI session token issuance
- `convex/review.ts` - review session lifecycle
- `convex/users.ts` - registration/profile/account lifecycle
- `convex/viewer.ts` - server-side viewer resolution helpers
- `deploy.sh` - VPS deploy logic

## Docs

- `AGENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/ROUTES.md`
- `docs/DEPLOYMENT.md`
- `docs/KNOWN_DEBT.md`
