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

## Private explainer gallery publisher

`/explainers/` is a private, Google-authenticated gallery rooted outside this
repository at `/var/www/explainers`. It is not a React route, a static overlay,
or part of the normal website deploy. Never use `deploy.sh`, `deploy-root.sh`,
Convex deployment, or a Caddy reload to publish an explainer.

The publisher is intentionally isolated:

- `scripts/explainers/gallery-index.mjs` validates only opaque index bytes,
  metadata, adapter contracts, declared paired byte ranges, and additive entry
  inventories. It has no card template, marker, insertion anchor, href parser,
  link convention, or ordering rule.
- A concrete `gallery-adapter.mjs` is deliberately absent from this initial
  work. Task 4 must first characterize the live gallery read-only, create a
  smallest neutral fixture, and receive review before an adapter is added.
- `scripts/explainers/publisher.mjs` exports injected `prepare`, `publish`, and
  `rollback` operations. Its filesystem and command/executor seams keep unit
  tests in temporary local roots and keep SSH key material out of arguments,
  source control, logs, and test fixtures. The CLI accepts only a key-file path
  and passes a private, temporary copy to a reviewed executor module only after
  native local checks prove the supplied path is absolute and normalized, has a
  canonical `realpath` equal to itself, has no symbolic-link component, and
  names a current-user-owned `0600` regular file. The CLI opens it with
  `O_NOFOLLOW`, verifies the opened descriptor's inode and metadata, copies that
  descriptor into an agent-owned `0700` temporary directory as a `0600` file,
  then removes the copy after the executor operation. It never accepts or reads
  key material as an option value.

### Publisher lifecycle and authorization

The private artifact, its metadata, fetched gallery bytes, credentials, and
transaction records stay outside Git. Metadata is schema version 1 and contains
only `slug`, title/summary text, creation time, and the artifact `index.html`
SHA-256; it carries no arbitrary gallery URL. Slugs are lowercase,
hyphen-separated path components and publication refuses a pre-existing slug.

Task 5 is the only production mutation. It may proceed only within the
separately approved target, account, immutable slug, and content scope, after a
reviewed adapter matches the read-only input. A changed target, account, slug,
or material content scope requires renewed authorization. This generic Task 1
code neither accesses nor infers the private gallery.

### Staging, promotion, and rollback gates

The adapter must return a structural fingerprint, existing and candidate entry
inventories, candidate bytes, and exact paired ranges in the before/after byte
buffers. The generic verifier refuses malformed metadata, unsafe or duplicate
slugs, undeclared byte changes, modified or removed existing entries, or any
candidate other than one additive entry. It independently inventories the
candidate bytes rather than trusting the adapter's claimed candidate inventory.
While holding the publisher lock, `publish` regenerates the complete candidate
from the re-read live bytes, metadata, and adapter, and rejects any reviewed
bytes, ranges, inventory, fingerprint, or version that no longer matches.

Publication records every phase in a journal under
`/var/www/.heydex-explainer-publisher/`, acquires an exclusive durable publisher
lease,
re-reads the live index and adapter fingerprint to refuse drift, stages and
checksums the artifact and candidate index (including the reviewed artifact
root `index.html` hash), snapshots the exact old index, then uses same-filesystem
renames to promote the artifact before the index. A failure between those
promotions removes only the just-promoted slug and proves absence with both
`lstat` and `test ! -e`; it does not touch unrelated artifacts.
The injected post-promotion verifier and authenticated rollback verifier are
mandatory, so a failed authenticated publication check triggers exact rollback
instead of leaving an unverified publication live.

Before any journal is created, the publisher verifies canonical, non-symlink,
disjoint gallery/state/artifact roots; expected owner, group, and strict root
modes; available space; and a shared filesystem device for atomic promotion.
State directories and journals are `0700`/`0600`; web artifact
directories/files are `0755`/`0644`; and index-exchange staging files preserve
the audited web-index ownership and mode while remaining inside a private
transaction directory. Every transaction file uses a unique same-directory,
exclusive no-follow temporary file, durable file sync, rename, and directory
sync. Artifact promotion uses Linux `renameat2(..., RENAME_NOREPLACE)` so an
existing destination cannot be overwritten.

The durable lease records the Linux boot ID, PID, and kernel process start time.
Lease acquisition first writes and fsyncs a complete JSON record to a unique
`O_EXCL|O_NOFOLLOW` temporary file, atomically installs it as `publisher.lock`
with `RENAME_NOREPLACE`, and fsyncs the lock directory. A crash before that
installation can leave only ignored lease temporaries, never an incomplete final
lock. It is released normally only by its matching owner; a fresh process can
reclaim a complete final lease after a crash only after proving the recorded
owner is gone or has a different start identity, preventing PID-reuse takeover.
Journal phases are written and synced before every promotion. The final index
update persists `index-promoting`, re-validates live bytes and metadata, then
uses atomic `renameat2(...,
RENAME_EXCHANGE)` to verify the displaced index still has the recorded prior
hash. If another writer appears in the last race window, the exchange is reversed
and the external bytes remain live.

Error recovery and later rollback inspect actual live index/artifact checksums
under the durable lease rather than trusting process-local flags: they restore
the exact prior index only when the recorded candidate remains live and refuse
unexplained drift. Artifact removal first atomically moves only the transaction
slug into its transaction-private quarantine, rechecks its complete checksum,
and deletes it only on an exact match. A changed quarantined artifact is retained
for reconciliation, never recursively deleted. A late external index change
before index promotion leaves that external index intact while removing only this
transaction's new artifact.

Rollback uses a separate durable index-exchange protocol. It stages the audited
previous index under the private transaction directory, records
`rollback-index-exchanging`, revalidates that the live index is the exact
recorded candidate (bytes, ownership, and mode), and exchanges the two paths.
It retains both paths until the displaced index is classified. A known candidate
is discarded only after the restored prior index is proven. If an external index
appears in the final rollback race, the publisher records
`rollback-index-reversing` before attempting the reverse exchange. An
interrupted or failed reversal records `rollback-index-manual-reconciliation`
with only a relative safe path (`index.html` or `rollback-index.html`) and the
available SHA-256 of the displaced regular file. It never deletes or silently
demotes unclassified external content; automatic recovery stops fail-closed, and
an explicit rollback retry can only attempt the safe reversal needed to return
that external content to the live index before again requiring manual
reconciliation.

The path-based CLI is intentionally incomplete until Task 4 supplies a reviewed
adapter and executor module:

```bash
node scripts/explainers/publisher.mjs prepare \
  --index /protected/index.html --metadata /protected/entry.json \
  --adapter /reviewed/gallery-adapter.mjs --output /protected/prepared.json

node scripts/explainers/publisher.mjs publish \
  --prepared /protected/prepared.json --adapter /reviewed/gallery-adapter.mjs \
  --artifact-dir /protected/artifact --gallery-root /var/www/explainers \
  --state-root /var/www/.heydex-explainer-publisher --transaction <id> \
  --security /protected/publisher-security.json --key-file /protected/key \
  --executor-module /reviewed/publisher-executor.mjs
```

`rollback` uses the same `--gallery-root`, `--state-root`, `--transaction`,
`--security`, `--key-file`, and `--executor-module` path options. The executor
module is the review point for remote filesystem behavior and authentication;
Task 1 neither supplies live host details nor accesses production.

Rollback is fail-closed. It refuses if the current index or promoted artifact
does not match the recorded transaction, atomically restores the byte-identical
previous index, deletes only the transaction slug (never a glob or prefix), and
again proves absence with `lstat` plus `test ! -e`. Final authenticated URL
verification accepts a legitimate `200` gallery fallback only when its body does
not contain artifact-specific title/marker text and its hash differs from the
recorded artifact. A `404` is not required.

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
