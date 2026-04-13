# Routes

## Canonical Map

| Path | Owner | Purpose | Status |
| --- | --- | --- | --- |
| `/` | static | marketing landing | canonical |
| `/privacy/` | static | privacy policy | canonical |
| `/connect/` | React | registration + CLI linking entry | canonical |
| `/diff/` | React | main DexDiff browse surface | canonical |
| `/diff/profile/` | React | signed-in user's own profile/settings page | canonical |
| `/diff/review/` | React | review + publish session page | canonical |
| `/diff/@:handle/` | React | dynamic public author profile | canonical |
| `/diff/community/` | static | editorial/community page | canonical |
| `/diff/company/` | static | editorial/company page | canonical |
| `/diff/love-letters/` | static | public love letters wall | canonical |
| `/diff/roadmap/` | static | editorial roadmap | canonical |
| `/diff/welcome/` | static | onboarding/editorial | canonical |
| `/diff/admin/` | static | admin/static residue | canonical but debt-heavy |
| `/diff/@dave/` | static | Dave snapshot page | intentional hybrid override for now |

## Deploy Rule

`deploy.sh` now overlays only the editorial/static directories after the React build deploy.

It intentionally does **not** overlay `diff/profile/`.

## Live Host Precedence

The live edge routing contract is Caddy and is mirrored in `ops/Caddyfile.heydex`.

Current precedence:
1. `/diff/profile/*` -> React always
2. exact `/diff` -> React always
3. generic `/diff/*` -> static subdir if present, else React fallback
4. `/connect/*` -> static file if present, else React fallback

Consequence:
- `/diff/review/` is React-owned on cold load
- `/diff/@some-handle/` is React-owned on cold load unless that exact static directory exists
- `/diff/@dave/` remains static until we remove or redirect that folder on the host

## Routing Guidance

When adding a new user-facing path:
1. Decide whether it is product stateful UX or editorial/static content.
2. Give it one owner only.
3. If React owns it, do not add a matching static folder.
4. If static owns it, do not add a React route that silently claims it.

## Publish Landing Rule

After publish, users now land on:

```text
/diff/@<handle>/
```

This is the canonical public profile path for any author, not just Dave.

## Resolved Duplicate Product HTML

These old duplicate product-route files were removed from the repo because the live Caddy contract already provides the needed fallback:

- `connect/index.html`
- `diff/index.html`
- `diff/profile/index.html`
