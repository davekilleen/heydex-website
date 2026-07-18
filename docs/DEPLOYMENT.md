# Deployment

## One authoritative branch: `main`

As of 2026-07-13, `main` is the single line the entire live site deploys from.
Between 2026-06-19 and 2026-07-13 the live site was split across two diverged
lines (`migrate-homepage-into-repo` carried the homepage + /desktop redesign
before they landed in `main`), which made a full `deploy.sh` from either line
silently regress the other's surfaces. That branch's content is fully contained
in `main` (verified commit-by-commit before retiring it); the stray branch has
been deleted. If you find yourself deploying from anything other than `main`,
stop and ask why.

## Private explainer direct-file publication

The private architecture explainer is not part of the React/Convex deployment.
The focused direct-file publisher addresses only the authorized fixed URL
`https://heydex.ai/explainers/dex-brain-vault-capability-architecture.html`,
the matching fixed target
`/var/www/explainers/dex-brain-vault-capability-architecture.html`, and its
transaction-private staging/quarantine paths. It does not import the generic
gallery publisher, enumerate the explainer root, read or write `index.html`,
create a card, use a root-wide lease, run `deploy.sh`, reload Caddy, or touch
another child.

Prepare the reviewed private artifact locally:

```bash
node scripts/explainers/direct-file.mjs prepare-file \
  --artifact /protected/artifact/index.html \
  --metadata /protected/artifact/gallery-entry.json \
  --output /protected/prepared-direct-file.json
```

The receipt checks the immutable slug and derived filename, exact SHA-256 and
size, restrictive no-network CSP, self-contained HTML, and absence of scripts,
remote assets, forms, executable handlers, or arbitrary target paths.

Publication and rollback hardcode the audited remote roots
`/var/www/explainers` and `/var/www/.heydex-explainer-publisher`; callers
cannot supply another root or child path. The command uses its internal,
reviewed fixed SSH executor/helper; there is no caller-selected executor module.
The helper accepts only the fixed target and transaction-private state paths for
upload, `lstat`/absence probes, metadata, fsync, `RENAME_NOREPLACE`, and exact
quarantine/removal. It never enumerates a directory or accepts a glob,
recursive operation, shell path, or unrelated child.

Publication is deliberately two-phase. `publish-file` performs only the
fixed-target upload and no-replace promotion, then records a random 32-byte
transaction nonce and `promotedAt` in a synced
`promoted-awaiting-verification` journal. It never marks the transaction
`published` and accepts no caller-authored verification JSON. `--promote-only
true` is explicit but optional because promotion-only is the only publish
behavior.

`finalize-file` invokes the internal fixed curl verifier after promotion. It
uses only the fixed HTTPS URL, never follows redirects, records exactly that
single request, and requires unauthenticated access to return `302`, `303`,
`307`, or `308` to the exact HeyDex OAuth gate
`https://heydex.ai/oauth2/sign_in` without an artifact hash or private marker.
It uses a supplied current-user-owned `0600` regular Netscape cookie-jar file
for the authenticated request, which must return the exact artifact hash/size
with `X-Robots-Tag: noindex, nofollow, noarchive`. The verifier itself binds the
fresh result to the transaction ID, nonce, `promotedAt`, URL, and hash/size;
finalization rechecks the sealed remote target identity after the network checks
before it can set the journal to `published`. Do not store cookie jars or
verification output in Git. If finalization fails, run exact
journal-authorized rollback; the transaction remains unpublished until that
separate recovery succeeds. Evidence availability never blocks a later
identity-authorized rollback:

```bash
node scripts/explainers/direct-file.mjs publish-file \
  --prepared /protected/prepared-direct-file.json \
  --promote-only true \
  --transaction <id> \
  --security /protected/publisher-security.json \
  --key-file /protected/key \
  --ssh-host publisher.example.internal \
  --ssh-user publisher

node scripts/explainers/direct-file.mjs finalize-file \
  --cookie-jar /protected/heydex-cookies.txt \
  --transaction <id> \
  --security /protected/publisher-security.json \
  --key-file /protected/key \
  --ssh-host publisher.example.internal \
  --ssh-user publisher

node scripts/explainers/direct-file.mjs rollback-file \
  --transaction <id> \
  --security /protected/publisher-security.json \
  --key-file /protected/key \
  --ssh-host publisher.example.internal \
  --ssh-user publisher \
  --verify-only true
```

Rollback is authorized by the synced journal and exact fixed target identity
(hash, size, regular-file type, owner, group, and mode). It quarantines and
removes only that unchanged target, proves both absence probes, and records
external verification as `verified`, `failed`, or `pending` without enumerating
unrelated children. Every mutation and recovery rechecks canonical real paths,
rejects nested symlink components, and requires every transaction/staging/
journal/quarantine/target directory to remain on the gallery filesystem. A
`RENAME_NOREPLACE` collision that leaves both live and staged candidates fails
closed and preserves both for reconciliation; it never treats either as owned
solely by matching content. `rollback-file --verify-only true` validates the
journal, paths, identities, quarantine absence, and planned exact operations
without writing anything. The staged key is normalized into a private temporary
file, validated with `ssh-keygen`, and removed after execution. A failed or
unavailable external check does not prevent journal-authorized rollback;
unavailable former-URL evidence remains `pending`.

## Convex Deployments

DexDiff has its own dedicated Convex project as of 2026-07-05. It no longer
shares a project with the desktop app; the hosted `/diff` + `/connect` surface
and the desktop app backend are intentionally separate.

| Surface | Convex project | Deployment | URL |
|---|---|---|---|
| `/diff` + `/connect` (PROD) | `heydex-web` | `gallant-reindeer-229` | `https://gallant-reindeer-229.eu-west-1.convex.cloud` |
| `/diff` + `/connect` (dev) | `heydex-web` | `bright-sandpiper-976` | `https://bright-sandpiper-976.eu-west-1.convex.cloud` |
| Legacy dev/test deployment (e2e suites, CI target) | `dex` | `brave-ibex-877` | `https://brave-ibex-877.eu-west-1.convex.cloud` |
| `/desktop` portal + desktop app backend | `dex` | `focused-mouse-723` | `https://focused-mouse-723.eu-west-1.convex.cloud` |

`deploy.sh` bakes `gallant-reindeer-229` into the `/diff`+`/connect` bundles
(Google-only sign-in via `VITE_AUTH_PROVIDERS=google`) and aborts if a bundle
references a known-wrong deployment.

## What Actually Deploys From This Repo

This repo deploys two different things:

1. Convex backend
2. Caddy-hosted web surfaces for `/diff/` and `/connect/`

The root marketing landing deploys via `deploy-root.sh`, which `deploy.sh`
calls on every frontend deploy (they were separate historically; the homepage
drifting out of sync is why they were coupled).

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

`POST /api/adoptions` records anonymous desktop adoption events from the shipped
Dex desktop client contract. Valid calls return `{ ok: true, recorded: n }`,
increment `adoptionCount` once for each requested published diff unless the call
is an idempotent replay or over the per-author daily ceiling, and write
`adoptionEvents` audit rows so abuse review or count correction can be performed
later. All invalid requests intentionally return the same opaque 400 JSON body.

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
   - `community`
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
- `/diff/@some-handle/` cold-loads into React because no static author directories are deployed — every handle, including `@dave`, resolves via the dynamic profile route
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
