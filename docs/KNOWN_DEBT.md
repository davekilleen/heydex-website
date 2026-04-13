# Known Debt

## Still Present

### Live route contract still lives outside deploy automation

We now have the live Caddy contract mirrored in `ops/Caddyfile.heydex`, but `deploy.sh` does not yet install or verify the live `/etc/caddy/Caddyfile`.

That means route ownership is documented and versioned, but not fully enforced by the deploy path.

### Root marketing deploy is still separate

`deploy.sh` handles `/diff/` and `/connect/`, not `/`.

That means the hosted product and the root marketing surface still do not share one deploy contract.

### `api.heydex.ai` verification is still weak from automation

Resolved:
- the hosted HTTP Actions contract is `https://api.heydex.ai/api/*`
- `dex-pi/lib/heydex-auth.ts` no longer points at `https://heydex.ai/api`
- repo docs now reflect the split host contract

Still awkward:
- the inspected Caddy host correctly does not own `/api/*`
- direct probes to `api.heydex.ai` from this environment hit Cloudflare `1010`
- that means the repo still lacks a reliable automated verification path for the live API host from CI/agent sessions

What still needs tightening:
- a smoke check run from an allowed environment
- or a non-public verification path that proves the live HTTP Actions domain and endpoints are healthy

### Public static snapshot still exists for Dave

`/diff/@dave/` is still a static snapshot and intentionally wins because the live Caddy contract serves real static subdirectories before React fallback under generic `/diff/*`.

The dynamic public profile route now exists for any handle, but Dave's profile stays hybrid until we choose a cutover.

Exit criteria for removing the static override:
- the dynamic `@dave` route matches the desired curated look/content
- publish and adoption flows are verified against the dynamic profile path
- the live `/var/www/heydex/diff/@dave/` directory is removed or replaced with an explicit redirect

### Validation is still smoke-test level

What is missing:
- live Google OAuth browser E2E that bypasses the "browser not secure" block
- authenticated self-profile coverage
- public profile adopt E2E for signed-in users
- deploy-time route ownership check

What landed:
- seeded browser E2E for review load/edit/publish
- CLI contract coverage for `/api/connect/redeem`, `/api/review/create`, and `/api/review/status`
- true CLI link -> browser review -> publish -> public profile coverage
- cold-load public profile browse coverage for non-self handles

### Convex public/admin surface still needs a final hardening pass

Some low-risk cleanup landed in this rebuild:
- internal viewer helpers
- internalized migration/admin delete helpers
- sanitized publish paths

Still worth auditing before broader launch:
- old admin/static surfaces
- any remaining internal-only functions exposed publicly
- long-lived maintenance helpers not yet fully fenced

### Live Google auth is still not automation-safe

The dedicated Google smoke now runs from saved Playwright auth state, which makes the reusable coverage path much more reliable.

What is better:
- the repeatable browser smoke no longer depends on re-entering credentials
- the saved state lives outside git under `playwright/.auth/`

What is still awkward:
- the auth-state bootstrap still has to hit the real Google flow in a headed browser
- Google can still reject fresh Playwright Chromium sign-in with:

- `Couldn’t sign you in`
- `This browser or app may not be secure`

That means the refresh path is better, but not fully automation-safe yet.

Decision still worth making:
- keep saved auth state only
- add a non-prod auth bypass
- or keep both

## Recommended Next Cuts

1. Decide and implement the Google auth automation strategy.
2. Add authenticated adopt coverage on public profiles.
3. Add self-profile browser coverage after auth.
4. Decide whether `/diff/@dave/` stays as a curated snapshot or becomes a redirect to the dynamic route.
5. Either deploy the checked-in Caddy contract automatically or add a live-config drift check.
6. Add a reliable health check for `api.heydex.ai` from an allowed environment.
7. Fold the portable DexDiff client into `dex-core` so `dex-pi` stops carrying the bridge code.
