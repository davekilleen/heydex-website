# Deployment

## What Actually Deploys From This Repo

This repo deploys two different things:

1. Convex backend
2. Caddy-hosted web surfaces for `/diff/` and `/connect/`

The root marketing landing is not part of `deploy.sh`.

## Backend Deploy

```bash
npm run convex:deploy
```

This publishes:
- auth routes
- queries/mutations/actions
- HTTP endpoints in `convex/http.ts`
- schema updates

The hosted HTTP actions contract is separate from the website:

```text
https://api.heydex.ai/api/*
```

That custom domain is owned by Convex HTTP Actions, not by the VPS Caddy config.

## Frontend Deploy

```bash
./deploy.sh
./deploy.sh --dry-run
./deploy.sh --skip-tests
```

`deploy.sh` now does this in order:

1. Runs `./test-production.sh https://heydex.ai` unless `--skip-tests`
2. Runs `npm run build`
3. Rsyncs `dist/` to a VPS staging directory
4. Creates route-scoped copies of the built React app with:
   - `<base href="/diff/">` for the `/diff/` surface
   - `<base href="/connect/">` for the `/connect/` surface
5. Copies those route-scoped builds into:
   - `/var/www/heydex/diff/`
   - `/var/www/heydex/connect/`
6. Overlays these static directories from `diff/`:
   - `@dave`
   - `community`
   - `company`
   - `love-letters`
   - `roadmap`
   - `welcome`
   - `admin`
7. Runs `npm run db:ensure`

## Live Edge Contract

The live host is currently:

```text
ubuntu@57.129.134.24
```

The live web server for `heydex.ai` is Caddy, not nginx.

Authoritative live file:

```text
/etc/caddy/Caddyfile
```

Checked-in mirror of the current live contract:

```text
ops/Caddyfile.heydex
```

Keep the checked-in file semantically aligned with the live route behavior whenever route ownership changes.

## Split Host Contract

Production is split across two hosts:

1. `https://heydex.ai`
   - marketing root
   - React product routes
   - static editorial routes

2. `https://api.heydex.ai`
   - Convex HTTP actions from `convex/http.ts`
   - CLI-facing endpoints like `/api/connect/redeem` and `/api/review/create`

Do not assume same-origin `/api/*` on `heydex.ai` unless the edge config is explicitly changed to proxy it.

## Route Precedence In Production

Production routing currently works in this order:

1. `/diff/profile` and `/diff/profile/*` force the React app from `/var/www/heydex/diff/index.html`
2. exact `/diff` and `/diff/` force the React app from `/var/www/heydex/diff/index.html`
3. generic `/diff/*` is hybrid:
   - if a real static subdirectory exists, Caddy serves that directory first
   - otherwise it falls back to `/var/www/heydex/diff/index.html`
4. `/connect` and `/connect/*` use the same fallback pattern rooted at `/var/www/heydex/connect`
5. everything else is served as plain static content from `/var/www/heydex`

This explains the current live behavior:
- `/diff/review/` cold-loads into React because no static `review/` directory exists
- `/diff/@some-handle/` cold-loads into React unless that handle has a real static folder
- `/diff/@dave/` still serves the static snapshot because that directory exists and wins
- slashless product roots like `/diff` and `/connect` should redirect to their trailing-slash forms so relative asset paths resolve correctly
- nested SPA routes like `/diff/review/` and `/diff/profile/` rely on route-scoped `<base href>` values so `./assets/...` resolves to `/diff/assets/...` instead of `/diff/review/assets/...`

## Why `diff/profile/` Is Not Overlaid

`/diff/profile/` is now React-owned for the signed-in self-profile/settings page.

If deploy overlays the old static `diff/profile/` directory, it reintroduces route collisions and breaks the product flow.

## Smoke Test Coverage

`test-production.sh` currently checks:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@route-smoke/`

This is intentionally light. It is a deploy guard, not a full product regression suite.

## Safe Deploy Sequence

Use this order when cutting product changes that touch both layers:

1. Deploy Convex first if the frontend depends on new backend fields or endpoints.
2. Run production smoke test.
3. Deploy the Caddy-hosted frontend.
4. Re-run smoke test manually if the change is route-sensitive.

## Known Missing Checks

- no automated browser walk of OAuth
- no automated CLI link + review + publish E2E
- no automated route ownership assertion against the live server config
- no automated public profile regression beyond basic route reachability
- no automated verification path for `api.heydex.ai` from this environment because direct probes are blocked by Cloudflare

Those gaps are tracked in `docs/KNOWN_DEBT.md`.
