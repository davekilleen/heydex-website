# DexDiff Private-Beta Gate

Convex is the authorization boundary. The Caddy/oauth2-proxy layer only hides
static HTML and is not trusted to protect DexDiff data or publishing.

## Rollout

1. Set `CONVEX_ENV=test` on the dedicated test deployment, then deploy the
   Convex schema and functions there.
2. Set `BETA_GATE=on` there and run `npm run e2e:beta`.
3. Set `CONVEX_ENV=prod` on production and verify
   `scripts/check-production-convex-env.sh` reports both that value and that
   `E2E_TEST_SECRET` is unset.
4. Deploy the same Convex functions to production.
5. Run `npx convex run --prod beta:seedAllowlist` once, then regenerate the
   cosmetic file from the table with
   `BETA_ALLOWLIST_PROD=1 scripts/export-beta-allowlist.sh`.
6. Only after the server boundary is verified, Dave may run
   `ops/setup-diff-google-gate.sh`.

No production step is performed by CI. CI deploys and tests only
`brave-ibex-877`.

## Rollback

- Convex: set `BETA_GATE=off` and deploy the functions. General beta-gated
  content returns to its pre-beta behavior without a schema change. Private
  profile grant redemption remains bound to an authenticated CLI recipient;
  the rollback flag does not reopen that content leak.
- Caddy: restore `/etc/caddy/Caddyfile.dexdiff-pre-gate` (or remove the
  `import /etc/caddy/diff-gate.caddy` line), validate, and reload Caddy.
- Do not delete `betaAllowlist` during rollback. It remains ready for re-enable.

## Explicit HTTP Route Inventory

The 36 explicit `convex/http.ts` registrations at `dbc7258`, plus the two
test-only removal-control registrations added by this change, are classified
below. `auth.addHttpRoutes(http)` also adds Convex Auth sign-in, sign-out,
callback, token, and session plumbing; those routes stay open because users
must be able to authenticate, and they expose no DexDiff content or publish
operation.

### Beta-gated data and write routes

| Route | Enforcement |
| --- | --- |
| `GET /api/diff` | Bearer CLI session → `requireBetaUser` before diff query |
| `GET /api/profile` | Bearer CLI session → `requireBetaUser` before profile query |
| `GET /api/profile-bundle` | Bearer CLI session → `requireBetaUser` before clone payload |
| `POST /api/profile-bundle/redeem` | Bearer CLI session must match the grant recipient; recipient and granter are beta-checked before a visibility-respecting bundle read |
| `GET /api/diffs` | Bearer CLI session → `requireBetaUser` before list |
| `POST /api/adoptions` | Bearer CLI session → `requireBetaUser` before counter/event mutation |
| `POST /api/connect/redeem` | code owner → `requireBetaUser` before code consumption/session mint |
| `POST /api/review/create` | CLI session/token owner → `requireBetaUser` before draft insertion |
| `GET /api/review/status` | Bearer CLI session → same-user session check + `requireBetaUser` |
| `POST /api/publish` | code owner → immutable user ID → internal beta-checked publish |
| `POST /api/love-letter` | code owner → immutable user ID → beta-checked submit |
| `GET /api/love-letters` | Bearer CLI session → `requireBetaUser` before list |

### Test-only routes

These routes are registered only when `CONVEX_ENV=test`; production and an
unset/mistyped environment both fail closed. Their backing fixture functions
enforce the same exact test-only signal, independently of routing. In the test
environment they return 404 when `E2E_TEST_SECRET` is unset and 403 without the
matching header. The deploy release gate requires
`CONVEX_ENV=prod` and separately fails if the test secret exists in production.

| Route |
| --- |
| `POST /api/test/bootstrap-cli` |
| `POST /api/test/bootstrap-connect-code` |
| `POST /api/test/bootstrap-review` |
| `POST /api/test/bootstrap-public-profile` |
| `POST /api/test/bootstrap-auth` |
| `POST /api/test/bootstrap-company-domain` |
| `GET /api/test/company` |
| `GET /api/test/diffs` |
| `POST /api/test/bootstrap-adoption` |
| `POST /api/test/bootstrap-adopt-grant` |
| `POST /api/test/set-beta-email` |
| `POST /api/test/remove-beta-email` |

### Open routes with no DexDiff content

| Route | Justification |
| --- | --- |
| `POST /api/waitlist` | admission funnel required for people outside the beta |
| `OPTIONS /api/waitlist` | CORS metadata only |
| `OPTIONS /api/love-letter` | CORS metadata only |
| `OPTIONS /api/love-letters` | CORS metadata only |
| `OPTIONS /api/connect/redeem` | CORS metadata only |
| `OPTIONS /api/publish` | CORS metadata only |
| `OPTIONS /api/review/create` | CORS metadata only |
| `OPTIONS /api/adoptions` | CORS metadata only |
| `OPTIONS /api/profile-bundle/redeem` | CORS metadata only |
| `OPTIONS /api/test/bootstrap-cli` | CORS metadata only; data route still needs test secret |
| `OPTIONS /api/test/bootstrap-connect-code` | CORS metadata only; data route still needs test secret |
| `OPTIONS /api/test/bootstrap-review` | CORS metadata only; data route still needs test secret |
| `OPTIONS /api/test/bootstrap-public-profile` | CORS metadata only; data route still needs test secret |
| `OPTIONS /api/test/bootstrap-adopt-grant` | CORS metadata only; data route still needs test secret |
| `OPTIONS /api/test/remove-beta-email` | CORS metadata only; data route still needs test secret |

## Direct Convex Surface

The public data queries (`diffs`, `profiles`, `loveLetters`, `adoptions`,
`companies`, and user content) call `requireBetaViewer`. Public mutations and
actions that register, edit, publish, adopt, create grants/codes/reviews, or
change visibility do the same. Token/code/session paths use
`requireBetaUser`.

Review session reads and edits additionally require the signed-in beta viewer
to own the session. `diffs.publishViaCode` is now an `internalMutation` and
accepts only the immutable user ID resolved from the redeemed code.

`waitlist.join` remains internal and reachable only through the open waitlist
HTTP route. `diffs.migrateFromDev` remains an `internalMutation`.
