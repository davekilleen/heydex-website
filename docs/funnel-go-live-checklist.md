# DexDiff QR Funnel — Go-Live Checklist

For the Mind the Product keynote, Tuesday 2026-06-16. Run top to bottom; every
step says WHO runs it, the exact command, what success looks like, and how to
roll back. Production is only touched from step 3 onward.

State as of 2026-06-10 (built by the funnel build agent):

- heydex-website branch `dexdiff-funnel` (local only, NOT pushed): seed payload,
  reseed script, seedV2 mutations, waitlist endpoint, QR page, installer,
  deploy-funnel.sh, sandbox loop harness, these docs
- dex-core worktree `/Users/dave.killeen/dex/product/dex-core-dexdiff-funnel`
  branch `dexdiff-funnel` (local only): fixed skills, hardened adoption module,
  bundled adopt script, staged vault telemetry fix
- The full loop has closed in sandbox (bootstrap -> fetch -> save -> generate ->
  adoption record): `bash scripts/sandbox-loop.sh` re-proves it any time
- `npx convex codegen` has already pushed the new functions to the DEV
  deployment and typechecked clean; PRODUCTION has not been touched

---

## Step 0 — Decisions (Dave, 5 min, no machine needed)

1. **Funnel mode for Tuesday.** Live adoption (default) or waitlist-only
   fallback. The decision can change as late as Monday night (one line on the
   QR page, see rollback notes at the bottom and the rehearsal runbook).
2. **The public handle.** This checklist assumes **`davekilleen`** (the real
   registered account; the review's default). The keynote phrase maps to
   `/diff-adopt-profile @davekilleen`. If you want `@dave` instead, say so
   BEFORE step 3 — it changes the reseed target, the QR page copy, and the
   skill examples, and requires freeing the handle from the orphan seed user
   (see Appendix A). Recommendation: keep `davekilleen`, rename later if it
   bothers you.

## Step 1 — Merge the funnel branches locally (Orchestrator, 5 min)

heydex-website (repo is parked on `main`; the work sits on `dexdiff-funnel`):

```bash
cd /Users/dave.killeen/dex/product/heydex-website
git status --short            # pre-existing uncommitted edits (AGENTS.md, settings/, src/...) are fine — they are disjoint from the funnel files
git checkout main
git merge dexdiff-funnel      # fast-forward-ish merge, no conflicts expected
git log --oneline -8          # success: the funnel commits are on main
```

dex-core: nothing to merge for Tuesday. The funnel runs entirely off the
heydex-hosted installer (route b). The dex-core branch `dexdiff-funnel` is the
durable source; publishing it through the release train is the post-keynote
item (Appendix C).

Do NOT push either repo from this machine without Dave's explicit go.

## Step 2 — Sanity pass before any production write (Orchestrator, 5 min)

```bash
cd /Users/dave.killeen/dex/product/heydex-website
node scripts/reseed-v2.cjs                 # DRY RUN
bash scripts/test-install-diff.sh          # installer invariants
bash scripts/sandbox-loop.sh               # full loop in sandbox
```

Success looks like: dry run prints the 8 workflows totalling ~242,973 chars
and "All validation gates passed"; installer prints "All installer assertions
passed."; sandbox loop ends with "LOOP CLOSED ... All green."

## Step 3 — Deploy the Convex backend (Orchestrator, 5 min) [PRODUCTION]

What ships: the `waitlist` table + POST `/api/waitlist`, and the three
`seedV2` internal mutations. Additive schema change; existing endpoints
untouched.

```bash
cd /Users/dave.killeen/dex/product/heydex-website
git status convex/            # success: clean (only committed funnel changes)
npm run convex:deploy         # deploys to PRODUCTION using the prod deploy key
```

Success: deploy completes listing the functions; then verify:

```bash
curl -s -X POST https://api.heydex.ai/api/waitlist \
  -H 'Content-Type: application/json' \
  -d '{"email":"dexdiff-checklist-test@heydex.ai","source":"go-live-checklist"}'
# success output: {"ok":true,"already":false}
```

Rollback: the endpoint and mutations are inert if unused; no rollback needed.
(To remove later: revert the commit and redeploy.)

## Step 4 — Re-seed production with the real v2 methodologies (Orchestrator, 5 min) [PRODUCTION]

This is break 3. Seeds the 8 full YAMLs under the REGISTERED `davekilleen`
user. It refuses to run if the user does not exist, and never creates users.

```bash
cd /Users/dave.killeen/dex/product/heydex-website
RESEED_PRODUCTION=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION \
  node scripts/reseed-v2.cjs --prod
```

Success: eight lines of `npx convex run seedV2:seedProfileDiff … --prod`, each
returning `{"action":"created"...,"methodologyChars":<20000-36000>}` (or
"updated" on re-run — the script is idempotent).

If it fails with `No user with handle "davekilleen"`: the registered account's
handle differs. Find it via the Convex dashboard (`npm run convex:dashboard`,
users table) and STOP — that is the step-0 handle decision resurfacing.

Rollback: re-running with corrected data overwrites; to remove the v2 diffs
entirely: `RESEED_PRODUCTION=... node scripts/reseed-v2.cjs --prod --archive-legacy davekilleen`
(archives them, reversible with `restore`).

## Step 5 — Flip Dave's profile public (Orchestrator, 1 min) [PRODUCTION]

This is break 2. Default visibility is private; anonymous QR scanners get 404
until this flips.

```bash
RESEED_PRODUCTION=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION \
  node scripts/reseed-v2.cjs --prod --set-visibility public
```

Success output: `{"handle":"davekilleen","visibility":"public"}`

Rollback: same command with `private`.

## Step 6 — Archive the legacy v1 summary diffs (Orchestrator, 1 min) [PRODUCTION]

The 7 old diffs live under the orphan `dave` seed user with 227-char
methodologies. Leaving them published means the /diff browse page shows two
Daves with conflicting content.

```bash
RESEED_PRODUCTION=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION \
  node scripts/reseed-v2.cjs --prod --archive-legacy dave
```

Success output: `{"handle":"dave","toStatus":"archived","changed":["meeting-intelligence","deal-intelligence","relationship-compounding","weekly-operating-rhythm","accountability-cracks","thought-leadership","self-improving-system"]}`

Known cost: any old links to `@dave` diffs stop resolving. Accepted.

Rollback: `... --prod --archive-legacy dave` is reversed by running
`npx convex run seedV2:archiveDiffsByHandle '{"handle":"dave","restore":true}' --prod`.

## Step 7 — Verify the API contract end to end (Orchestrator, 2 min)

```bash
curl -s "https://api.heydex.ai/api/profile-bundle?handle=davekilleen" | python3 -c "
import json,sys
b=json.load(sys.stdin)
print('contract:', b['contractVersion'])
print('workflows:', len(b['workflows']))
print('smallest methodology:', min(len(w['methodology']) for w in b['workflows']), 'chars')"
```

Success looks exactly like:

```
contract: 2026-04-10
workflows: 8
smallest methodology: 21427 chars
```

If `smallest methodology` is under ~1000, the seed did not carry the YAMLs —
stop and rerun step 4. Also open https://heydex.ai/diff/@davekilleen/ in a
private browser window: profile renders with 8 workflows (no sign-in).

## Step 8 — Deploy the QR page and the installer (Orchestrator, 5 min) [PRODUCTION]

```bash
cd /Users/dave.killeen/dex/product/heydex-website
./deploy-funnel.sh
```

This stages and promotes exactly two files on the Caddy host
(`ubuntu@57.129.134.24`, key `~/.ssh/acfs_ed25519`) and then verifies live:
`https://heydex.ai/install-diff` (200, shell shebang, byte-identical to the
repo build) and `https://heydex.ai/diff/like-dave/` (200, page content). No
Caddy config change is needed — both paths are covered by the existing
file_server rules (verified against ops/Caddyfile.heydex).

Success output ends with `✓ Funnel assets deployed`.

Note: install-diff.sh is GENERATED. If any dex-core skill changed since the
last build, regenerate first and commit:

```bash
node scripts/build-install-diff.mjs \
  --skills-root /Users/dave.killeen/dex/product/dex-core-dexdiff-funnel/.claude/skills
bash scripts/test-install-diff.sh
```

Rollback: `ssh -i ~/.ssh/acfs_ed25519 ubuntu@57.129.134.24 "sudo rm /var/www/heydex/install-diff && sudo rm -rf /var/www/heydex/diff/like-dave"`

## Step 9 — Full stranger-path verification (Dave + Orchestrator together, 10 min)

On any machine (Dave's laptop is fine), in a THROWAWAY folder:

```bash
mkdir -p /tmp/qr-check/.claude && echo "# t" > /tmp/qr-check/CLAUDE.md
cd /tmp/qr-check
curl -fsSL https://heydex.ai/install-diff | bash
# success: "Added 7 file(s), kept 0" + next-steps text

python3 .claude/skills/diff-adopt-profile/scripts/adopt_profile.py @davekilleen --fetch-only
# success: "Profile: Dave Killeen (@davekilleen)" + 8 workflows, NO warnings
```

If both pass, the wire format, hosting, seed, and visibility are all correct
against real production for the first time.

## Step 10 — Apply the vault-side telemetry fix (Orchestrator, 5 min) [VAULT]

The delight-capture hook (the love-letter engine) has captured nothing for 10
weeks. The corrected file is staged in dex-core:

```bash
cd /Users/dave.killeen/dex/product/dex-core-dexdiff-funnel/staging/vault-fixes
node test-delight-capture.cjs        # success: "All delight-capture assertions passed."
cp delight-capture.cjs /Users/dave.killeen/Vault/.claude/hooks/delight-capture.cjs
```

No settings.json change needed (registration is already correct). Rollback:
`git -C /Users/dave.killeen/Vault checkout -- .claude/hooks/delight-capture.cjs`.

## Step 11 — QR code (Dave, 5 min)

Generate the QR for `https://heydex.ai/diff/like-dave/` (any generator, black
on white, plain — no logo overlay at conference-screen distance). Put it on
the slide AND print a card backup. Scan it from a phone on conference-grade
wifi expectations (try it tethered to mobile data) and confirm the page loads.

## Optional — renew the heydex publish token (Dave, 2 min)

`~/.dex/heydex-auth.json` is ~62 days old (30-day validity). NOT needed for
the funnel (adoption and waitlist are anonymous), only for `/diff-profile`
publish flows. Renew via `https://heydex.ai/connect/?cli=true` if you plan to
demo publishing.

---

## Who-does-what summary

| # | Step | Who | Prod? |
|---|---|---|---|
| 0 | Mode + handle decisions | Dave | no |
| 1 | Merge branches locally | Orchestrator | no |
| 2 | Dry run + sandbox loop | Orchestrator | no |
| 3 | Convex deploy (waitlist + seedV2) | Orchestrator | YES |
| 4 | Re-seed v2 methodologies | Orchestrator | YES |
| 5 | Visibility public | Orchestrator | YES |
| 6 | Archive legacy v1 diffs | Orchestrator | YES |
| 7 | API verification curls | Orchestrator | read-only |
| 8 | Deploy page + installer | Orchestrator | YES |
| 9 | Stranger-path verification | Dave + Orchestrator | read-only |
| 10 | Vault telemetry fix | Orchestrator | vault |
| 11 | QR generation + scan test | Dave | no |

## Appendix A — if Dave insists on @dave

1. Free the handle: merge the orphan seed user into the real account with
   `convex/adminMerge.ts:mergeAndDeleteOrphan` (needs both user ids from the
   dashboard; the orphan is the one with `tokenIdentifier: "seed:dave"`).
   CAUTION: the merge copies the orphan's handle (`dave`) onto the auth record.
2. Re-run steps 4-7 — but first edit `seed-data/dave-profile-v2/manifest.json`
   user.handle to `dave` (or re-export with the script), and update the handle
   in `diff/like-dave/index.html` and the two skill examples, then regenerate
   the installer.

## Appendix B — abort to waitlist-only (any time before the talk)

1. Edit `diff/like-dave/index.html`: `const DEFAULT_FUNNEL_MODE = "waitlist";`
2. `./deploy-funnel.sh`
3. Done — the page hides the install path and the waitlist becomes the only
   CTA. Preview without deploying: `https://heydex.ai/diff/like-dave/?mode=waitlist`.

## Appendix C — post-keynote debt (not for Tuesday)

- Publish the DexDiff surface to public dex-core properly (route a): the
  `dexdiff-funnel` branch in the dex-core worktree is the source; it must go
  through the CI gate battery and the active fleet's orchestrator.
- Converge the vault skills / dex-core skills / production seed onto dex-core
  as canonical (review section 5.2).
- Wire `build-workflow-model.cjs` into weekly synthesis; make the concierge
  hook emit `hookSpecificOutput.additionalContext` (review "during seed" items).
- Decide the fate of the legacy `dave` orphan user row.
- The new Convex functions also exist on the DEV deployment (codegen side
  effect during the build, harmless); clean up or keep for rehearsals.
