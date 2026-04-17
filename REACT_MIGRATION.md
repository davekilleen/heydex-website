# React Migration - Architecture & Implementation

## Overview

The heydex-website has been migrated from vanilla HTML/JS to a React + Vite SPA that properly implements Convex Auth according to the official documentation.

## What Changed

### Before (Vanilla HTML/JS)
- Manual `fetch()` calls to Convex API endpoints
- Custom token management using localStorage
- Raw OAuth flow implementation
- Repeated code across pages
- Static HTML files with embedded JavaScript
- No proper auth context

### After (React + Convex)
- Proper `ConvexProvider` wrapping the app
- `useQuery()` and `useMutation()` hooks from Convex
- `useAction()` for auth:signIn action
- Token stored by Convex Auth in `__convexAuthJWT`
- Single SPA serving both /diff and /connect routes
- Vite build system for optimized production bundle

## Key Architecture Decisions

### 1. ConvexAuthProvider Removed (Intentional)
We're NOT using `ConvexAuthProvider` from `@convex-dev/auth/react` because:
- Our pages are vanilla HTML/JS rendered as static files before this migration
- We manually manage token state and check localStorage for the JWT
- Full ConvexAuthProvider integration would require a complete React app context, which we're building incrementally

**For production enhancement:** We should consider wrapping the entire app with ConvexAuthProvider for automatic refresh token rotation and session management.

### 2. String-Based Function Names
Components use string-based function calls instead of typed imports:
```jsx
// Instead of: import { api } from './convex/_generated/api'
// We use:
const userMe = useQuery('users:me');
const registerUser = useMutation('users:register');
const signInAction = useAction('auth:signIn');
```

**Why:** The generated API types live in `dexdiff-platform/convex/_generated/`, not in `heydex-website`. String-based names are valid in Convex and avoid cross-repo dependencies.

## OAuth Flow (Now Correct)

1. User clicks "Continue with Google"
2. `handleOAuth()` calls `auth:signIn` action with provider
3. Convex Auth returns `redirect` URL to Google's OAuth endpoint
4. User redirected to Google login
5. Google redirects back to `${CONVEX_SITE_URL}/api/auth/callback/google`
6. Convex Auth processes the OAuth response (handled automatically)
7. JWT token stored in localStorage under `__convexAuthJWT`
8. Page detects token and calls `users:me` query
9. If user has no handle, show profile completion form
10. After registration, show connection code or redirect to /diff

## Token Management

**Storage Key:** `__convexAuthJWT` (set by Convex Auth)

**What we do:**
- Read token on page load: `localStorage.getItem('__convexAuthJWT')`
- Check if authenticated: token exists in localStorage
- Pass token in requests: Already handled by Convex hooks (Authorization header)
- Clear on logout: `localStorage.removeItem('__convexAuthJWT')`

**What we DON'T do (Convex handles these):**
- Token refresh (automatic)
- Refresh token reuse detection (automatic)
- Token expiration handling (automatic)

## File Structure

```
heydex-website/
├── src/
│   ├── main.jsx              # React entry point, sets up ConvexProvider
│   ├── App.jsx               # Routes between ConnectPage and DiffPage
│   └── pages/
│       ├── ConnectPage.jsx   # Registration & connection codes
│       ├── ConnectPage.module.css
│       ├── DiffPage.jsx      # Browse & adopt diffs
│       └── DiffPage.module.css
├── index.html                # Vite entry point (SPA)
├── package.json              # Dependencies
├── vite.config.js            # Build configuration
├── .env.local                # Local development environment
└── deploy.sh                 # Build & deploy script
```

## Environment Configuration

**Development (.env.local):**
```
VITE_CONVEX_URL=https://dexdiff-platform.convex.site
```

**Build:** `npm run build` → outputs to `dist/`

**Deploy:** `bash deploy.sh` → builds, then syncs dist/ to VPS

## Server-Side Authentication (Unchanged)

All server functions in `dexdiff-platform/convex/` already use proper auth:

```typescript
// users.ts - Example
const identity = await ctx.auth.getUserIdentity();
if (!identity) throw new Error("Not authenticated");
```

This is correct and doesn't need changes.

## Testing Checklist

- [ ] Visit heydex.ai/connect/
- [ ] Click "Continue with Google"
- [ ] Should redirect to Google login
- [ ] After login, should return to /connect/ with profile form
- [ ] Complete profile, create account
- [ ] Should see connection code
- [ ] Visit heydex.ai/diff/
- [ ] Should see published diffs
- [ ] Click on a diff (would need detail page implementation)

## Known Limitations & Future Work

1. **Root landing page** - Not yet integrated into React SPA
   - Currently served as static HTML
   - Should be converted to React component

2. **Diff detail page** - Not implemented
   - URL pattern: `/diff/{author}/{diffId}`
   - Would need separate route handler in App.jsx

3. **User profile page** - Not implemented
   - URL pattern: `/profile/{handle}`
   - Would need API endpoint to fetch user profile with diffs

4. **ConvexAuthProvider** - Not enabled
   - Should be added when ready to handle refresh token rotation
   - Would require wrapping App with ConvexAuthProvider at main.jsx level

5. **Avatar URLs** - Currently not stored
   - LinkedIn profile photos aren't being captured during registration
   - Would need to add LinkedIn OAuth photo extraction in users:register

## Environment Variables

The app expects `VITE_CONVEX_URL` which points to the dexdiff-platform deployment. This is set in `.env.local` for development and hardcoded in `src/main.jsx` for production.

## Deployment Process

```bash
cd /Users/dave.killeen/Desktop/heydex-website
bash deploy.sh
```

This will:
1. Run `npm install` (cached if up to date)
2. Run `npm run build` (creates dist/)
3. Sync dist/ to VPS staging directories
4. Copy from staging to /var/www/heydex/diff/ and /var/www/heydex/connect/

Both routes serve the same React SPA (single index.html), which detects the current URL and renders the appropriate page.
