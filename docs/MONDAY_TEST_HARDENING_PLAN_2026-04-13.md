# Monday Test Hardening Plan

## What Landed

- Seeded Playwright coverage now proves:
  - `/api/connect/redeem`
  - `/api/review/create`
  - `/api/review/status`
  - invalid, expired, and already-used connection code handling
  - expired CLI session-token rejection
  - CLI link -> browser review -> publish -> public profile
  - public-profile cold loads for non-self handles
  - review edit persistence and expired-session recovery

- Verification pass:

```bash
./scripts/run-e2e-dev.sh tests/e2e/cli-contract.spec.ts tests/e2e/connect-redeem.spec.ts tests/e2e/cli-browser-roundtrip.spec.ts tests/e2e/profile-bundle.spec.ts tests/e2e/public-profile-browse.spec.ts tests/e2e/review-session.spec.ts tests/e2e/review-session-expired.spec.ts
```

- Result: `9 passed`

## Remaining Gaps

1. Live Google auth is not reliably automatable with credentials alone.
2. The browser suite still does not cover authenticated self-profile behavior.
3. Public-profile browse is covered, but authenticated adopt behavior is not.
4. Live `api.heydex.ai` health is still hard to verify from this environment because of Cloudflare restrictions.
5. Deploy automation still does not prove live Caddy route ownership end to end.

## Monday Order

1. Decide the Google path.
   - Landed: saved Playwright auth state for the dedicated Google test account is now the default path.
   - Remaining fallback decision: keep or add a non-prod-only auth bypass if Google keeps blocking state refresh.
   - Exit criterion: one repeatable `google-auth.spec.ts` path that passes without manual typing.

2. Add authenticated public-profile adopt coverage.
   - Seed a public profile.
   - Log in with the test user or saved auth state.
   - Verify the profile page stops showing `Register to copy`.
   - Assert the adopt command/button path reflects authenticated state and any adopted-workflow marker.

3. Add self-profile browser coverage.
   - Start from authenticated state.
   - Visit `/diff/profile/`.
   - Assert profile header, visibility changes, edit/save flow, and Love Letter entry point.

4. Add one allowed-environment smoke for `api.heydex.ai`.
   - Probe `/api/connect/redeem` and `/api/review/status` from a network path Cloudflare accepts.
   - If that is not possible from CI, add a manual release-gate script run from the VPS or another allowed host.

5. Add deploy-time route verification.
   - Extend deploy verification so it checks:
     - `/diff/`
     - `/connect/`
     - React fallback for `/diff/@handle/`
     - API host split between `heydex.ai` and `api.heydex.ai`

## Concrete Monday Deliverables

- `tests/e2e/google-auth.spec.ts` made repeatable
- `tests/e2e/public-profile-adopt.spec.ts`
- `tests/e2e/self-profile.spec.ts`
- one `api.heydex.ai` smoke script or allowed-host runbook
- deploy verification tightened around route ownership
