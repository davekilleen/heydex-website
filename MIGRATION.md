# DexDiff Backend Consolidation

**Date:** 2026-04-05  
**Migration:** dexdiff-platform → heydex-website

## What Changed

Previously, the DexDiff Convex backend lived in a separate `dexdiff-platform` repository. This created unnecessary repo fragmentation for tightly coupled code.

**Before:**
- `dexdiff-platform/` - Convex backend only
- `heydex-website/` - Frontend (React + static HTML)
- Two repos, two package.jsons, split mental model

**After:**
- `heydex-website/` - Frontend + backend together
  - `convex/` - Serverless backend (TypeScript)
  - `src/` - React main site
  - `diff/` - DexDiff static pages
  - `connect/` - Connect page
- Single repo, single source of truth

## Files Moved

```
dexdiff-platform/convex/*  → heydex-website/convex/
  ├── schema.ts            → Database tables
  ├── auth.ts              → Authentication
  ├── diffs.ts             → Diff operations
  ├── users.ts             → User management
  ├── companies.ts         → Company grouping
  ├── profiles.ts          → Profile queries
  ├── adoptions.ts         → Adoption tracking
  ├── email.ts             → Email sending
  ├── enrichment.ts        → Data enrichment
  ├── loveLetters.ts       → Love letters feature
  ├── admin*.ts            → Admin tools
  └── (22 total files)
```

## Configuration Changes

### package.json

Added Convex scripts:

```json
{
  "scripts": {
    "convex:dev": "npx convex dev",
    "convex:deploy": "npx convex deploy",
    "convex:dashboard": "npx convex dashboard"
  }
}
```

Dependencies already existed (convex@1.34.1, @convex-dev/auth@0.0.91).

### .env.local

Updated to point to consolidated Convex deployment:

```bash
CONVEX_DEPLOYMENT=dev:brave-ibex-877
CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
VITE_CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
```

Previously pointed to `focused-mouse-723` (now deprecated).

### .gitignore

Added:

```
convex/_generated/
```

## Deployment Changes

### Before Migration

**Backend:**
```bash
cd dexdiff-platform
npx convex deploy
```

**Frontend:**
```bash
cd heydex-website
./deploy.sh
```

### After Migration

**Backend:**
```bash
cd heydex-website
npm run convex:deploy
```

**Frontend:**
```bash
cd heydex-website
./deploy.sh
```

Same deployment targets, same infrastructure - just consolidated commands.

## Development Workflow

### Old Workflow (Two Repos)

```bash
# Terminal 1: Backend
cd dexdiff-platform
npx convex dev

# Terminal 2: Frontend
cd heydex-website
npm run dev

# Mental overhead: track changes across 2 repos, 2 package.jsons
```

### New Workflow (One Repo)

```bash
# Terminal 1: Backend
cd heydex-website
npm run convex:dev

# Terminal 2: Frontend
cd heydex-website
npm run dev

# Atomic commits, single package.json, unified mental model
```

## What Didn't Change

- ✓ Convex deployment (`brave-ibex-877`) - same project
- ✓ Frontend VPS deployment - same rsync target
- ✓ Convex schema - zero code changes
- ✓ Package versions - already aligned
- ✓ Git history - preserved via copy (not move)

## Validation

All work packages passed validation:

- ✓ WP-1: Pre-migration audit complete
- ✓ WP-2: Files copied (22 TypeScript files)
- ✓ WP-3: package.json updated with scripts
- ✓ WP-4: .gitignore + .env.local configured
- ✓ WP-5: Convex dev server tested successfully
- ✓ WP-6: Documentation updated

## Archived Repo

The original `dexdiff-platform` repository has been:
1. Tagged with `final-pre-consolidation`
2. Renamed to `dexdiff-platform-ARCHIVED`
3. README updated with deprecation notice

**Do not commit new changes to the archived repo.**

## Benefits

1. **Atomic commits** - Change schema + frontend in one PR
2. **Simpler onboarding** - Clone one repo, not two
3. **No version skew** - Single package.json means dependencies stay aligned
4. **Unified deployment** - Deploy backend + frontend from same directory
5. **Better for DESIGN.md** - One design system file for all heydex.ai surfaces

## Rollback Plan

If something breaks:

```bash
# Revert heydex-website to pre-migration state
cd /Users/dave.killeen/dex/product/heydex-website
git log --oneline | grep -i migration  # Find migration commit
git revert <commit-hash>

# Restore dexdiff-platform
cd /Users/dave.killeen/dex/product
mv dexdiff-platform-ARCHIVED dexdiff-platform
```

All Convex data preserved (migration only moved code, not data).

---

**Status:** Migration complete and validated - 2026-04-05
