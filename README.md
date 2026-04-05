# heydex-website

Marketing website and DexDiff platform for heydex.ai.

## Structure

```
heydex-website/
├── src/              # Main website (React + Vite)
├── diff/             # DexDiff static pages
├── connect/          # Connect page
├── convex/           # Backend (Convex serverless)
└── dist/             # Build output
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Start Convex dev server (watches convex/ directory)
npm run convex:dev

# In another terminal: start frontend dev server
npm run dev
```

The frontend will be available at `http://localhost:5173` (or next available port).

### Convex Backend

The `convex/` directory contains the serverless backend for DexDiff:

- **schema.ts** - Database tables (diffs, users, companies, adoptions, etc.)
- **auth.ts** - Email + Google OAuth authentication
- **diffs.ts** - Diff publishing, fetching, search
- **users.ts** - User registration and profiles
- **companies.ts** - Domain-based company grouping
- **profiles.ts** - Author profile queries

**Commands:**

```bash
# Start local dev server (auto-deploys to dev environment)
npm run convex:dev

# Deploy to production
npm run convex:deploy

# Open Convex dashboard
npm run convex:dashboard
```

**Environment Variables:**

Create `.env.local` (gitignored) with:

```bash
# Convex deployment
CONVEX_DEPLOYMENT=dev:brave-ibex-877
CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
CONVEX_SITE_URL=https://brave-ibex-877.eu-west-1.convex.site

# For Vite frontend
VITE_CONVEX_URL=https://brave-ibex-877.eu-west-1.convex.cloud
```

## Deployment

### Frontend (Static Pages)

Deploy `/diff` and `/connect` pages to VPS:

```bash
./deploy.sh          # Deploy to production
./deploy.sh --dry-run  # Preview changes
```

This rsync's static HTML pages to the VPS at `heydex.ai/diff/`.

### Backend (Convex)

```bash
npm run convex:deploy
```

Deploys serverless functions to Convex cloud. Frontend and backend deploy independently.

### Full Stack Build

```bash
# Build frontend
npm run build

# Deploy Convex backend
npm run convex:deploy

# Deploy static pages
./deploy.sh
```

## Migration Notes

**2026-04-05:** Consolidated DexDiff backend from `dexdiff-platform` repo into this repo. See `MIGRATION.md` for details.

Previously, Convex backend lived in a separate `dexdiff-platform` repository. Now all heydex.ai surfaces (marketing, /diff, /connect) and their shared backend live in one repository.

## Scripts Reference

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start Vite dev server (frontend) |
| `npm run build` | Build frontend for production |
| `npm run preview` | Preview production build locally |
| `npm run convex:dev` | Start Convex dev server (backend) |
| `npm run convex:deploy` | Deploy Convex to production |
| `npm run convex:dashboard` | Open Convex web dashboard |
| `./deploy.sh` | Deploy static pages to VPS |

## Tech Stack

- **Frontend:** React 18 + Vite 5 + React Router
- **Backend:** Convex (TypeScript serverless)
- **Auth:** Convex Auth (email + Google OAuth)
- **Deployment:** VPS (nginx) + Convex Cloud
