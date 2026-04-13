# DexDiff Hosted Surface

## Repo Identity

- Repo: `heydex-website`
- Owns: hosted web UX, hosted auth, hosted review/publish contract, public profile surfaces, adoption APIs
- Shared Dex family context: `../CLAUDE.md`

## Canonical Before Editing

Check these first:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ROUTES.md`
- `docs/DEPLOYMENT.md`
- `docs/KNOWN_DEBT.md`

## Route Ownership

React canonical:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@:handle/`

Static canonical:
- `/`
- `/privacy/`
- `/diff/community/`
- `/diff/company/`
- `/diff/love-letters/`
- `/diff/roadmap/`
- `/diff/welcome/`
- `/diff/admin/`
- `/diff/@dave/`

Do not let static overlays reclaim a React-owned path.
The live edge-routing contract is Caddy and is mirrored in `ops/Caddyfile.heydex`.

## Auth Contract Rules

- Browser auth lives in Convex Auth
- Server-side app identity should resolve from the authenticated viewer, not user-supplied identifiers
- CLI clients must use the hosted session-token contract, not raw Convex `tokenIdentifier`
- If you touch `convex/connect.ts`, `convex/review.ts`, or `convex/viewer.ts`, verify the full CLI link → review → publish flow

## Cross-Repo Boundary

- `heydex-website` owns the hosted contract
- `dex-core` should own the portable `/diff-*` runtime/client layer
- `dex-pi` is not the long-term owner of the publish runtime

If you need to change the portable CLI behavior, update the shared contract in `dex-core` too.

## Deploy Safety

- `deploy.sh` deploys the React build to `/diff/` and `/connect/`
- static editorial directories are overlaid afterward
- root landing is outside this deploy flow
- the live host is currently `ubuntu@57.129.134.24`
- `/diff/profile/` is a special-case React override before generic `/diff/*`
- generic `/diff/*` is hybrid: static subdir wins if present, else React fallback
- run `./test-production.sh` unless explicitly skipping

## Current Sharp Edges

- root marketing landing is still separate from the React deployment path
- `/diff/@dave/` is still an intentional static snapshot override
- validation coverage is still smoke-test level, not full E2E
