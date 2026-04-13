# Architecture

## What This Repo Is

`heydex-website` is the hosted DexDiff system.

It combines:
- the hosted React product surfaces
- static editorial/community pages
- the Convex backend for auth, users, diffs, review sessions, adoptions, and public profiles

It is the system of record for:
- user registration
- profile visibility
- published diffs
- CLI linking
- review sessions
- adoption metadata

## System Split

Hosted side in this repo:
- browser auth and registration
- public/community browse
- publish review UI
- public author profiles
- adoption APIs

Hosted domains:
- `https://heydex.ai` serves the web product surfaces
- `https://api.heydex.ai` serves Convex HTTP actions

Portable runtime side outside this repo:
- `/diff-*` command surface
- local vault generation and application of adopted workflows

That portable runtime should converge into `dex-core`.

## Route Model

React:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@:handle/`

Static:
- `/`
- `/privacy/`
- editorial/community pages under `diff/`

Important: React-owned paths are exact-product paths. The app intentionally returns `null` for unknown paths so static surfaces can own them.

## Identity Model

There are two different identity concepts in play:

1. Browser identity
- issued by Convex Auth
- canonical stable key is `identity.tokenIdentifier`

2. CLI session identity
- issued only after `https://api.heydex.ai/api/connect/redeem`
- now represented by a hosted `sessionToken`
- used by CLI clients for review/publish initiation

Current implementation rule:
- backend mutations resolve the viewer from server auth whenever possible
- stored user rows keep `tokenIdentifier` in sync through `convex/viewer.ts`
- CLI clients do **not** receive or reuse raw `tokenIdentifier`

## End-To-End Journeys

### Anonymous Browse
1. User lands on `/diff/` or `/diff/@:handle/`
2. React loads published diffs or public profile data from Convex queries
3. Unauthenticated users see register CTA instead of adoption state

### Browser Registration
1. User lands on `/connect/`
2. OAuth completes through Convex Auth
3. `users.register` completes the profile and handle claim
4. User is redirected to `/diff/profile/`

### CLI Link
1. CLI opens `/connect/?cli=true`
2. Signed-in browser calls `connect.generateCode`
3. User pastes the short code into the terminal
4. Browser approves with `connect.approveCode`
5. CLI redeems via `https://api.heydex.ai/api/connect/redeem`
6. Backend returns a hosted `sessionToken`

### CLI Review + Publish
1. CLI posts generated diffs to `https://api.heydex.ai/api/review/create` using the `sessionToken`
2. Backend creates a short-lived review session in `reviewSessions`
3. Browser opens `/diff/review/?session=...`
4. User confirms privacy and publishes
5. `review.publishFromSession` upserts diffs and optionally flips profile visibility
6. User lands on `/diff/@:handle/`

### Adoption
1. User browses `/diff/@:handle/`
2. User copies `/diff-adopt ...` or `/diff-adopt-profile ...`
3. Local runtime applies the hosted methodology contract
4. Hosted side records adoption metadata with `adoptions.record`

## Backend Files

- `convex/viewer.ts`
  - canonical viewer resolution helpers
- `convex/users.ts`
  - registration, profile edits, account deletion, visibility
- `convex/connect.ts`
  - code generation, approval, redeem, CLI session token issuance
- `convex/review.ts`
  - review session creation, privacy update, publish
- `convex/diffs.ts`
  - published diff browse and publish upserts
- `convex/profiles.ts`
  - public profile fetch
- `convex/adoptions.ts`
  - adoption record/remove/mine
- `convex/http.ts`
  - hosted HTTP contract exposed to CLI/runtime clients

## Current Boundary Decision

- `heydex-website`: hosted contract owner
- `dex-core`: portable command/runtime owner
- `dex-pi`: reference material only for current CLI flow and planning docs

## Remaining Debt

Read `docs/KNOWN_DEBT.md`.
