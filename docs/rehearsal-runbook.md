# DexDiff QR Funnel, Monday Rehearsal Runbook

30 minutes, Monday 2026-06-15, AFTER go-live checklist steps 3-8 are complete
(production seeded, profile public, page + installer live). This rehearses the
exact stranger path against real production from a clean machine, and ends
with a binary go/no-go for Tuesday's live mode.

## Setup you need before the clock starts

- A clean macOS environment. Best: a fresh macOS user account on any Mac.
  Acceptable: a scrubbed temp HOME on Dave's laptop:
  `export HOME=$(mktemp -d /tmp/rehearsal-home.XXXX) && cd $HOME`
  (new shell only, do not reuse a shell that has sourced Dave's profile)
- Claude Code installed and signed in within that environment. This is the one
  concession to realism: Tuesday's strangers bring their own working Claude
  Code. Everything else must start from zero.
- A phone on mobile data (NOT the venue/home wifi) with the actual QR slide.
- A printed copy of this runbook and a timer.

## The clock

| T | Stage | Exact action | Success criteria (all must hold) |
|---|---|---|---|
| 0:00 | QR scan | Scan the slide QR with the phone on mobile data | `https://heydex.ai/diff/like-dave/` renders in < 5s; install command + copy button visible |
| 0:02 | Get Dex | On the clean machine: `git clone https://github.com/davekilleen/Dex.git ~/Dex && cd ~/Dex` | Clone completes; folder contains `CLAUDE.md` and `.claude/` |
| 0:06 | Bootstrap | Copy the command off the page: `curl -fsSL https://heydex.ai/install-diff \| bash` | Output says `Added 7 file(s), kept 0`; lists `diff-adopt-profile/SKILL.md`; says python3 found; `api.heydex.ai reachable` |
| 0:08 | Re-run check | Run the same command again | `Added 0 file(s), kept 7` + "already installed" (idempotence on a real machine) |
| 0:09 | The phrase | Open Claude Code in `~/Dex`, type exactly: `set me up like Dave` | Claude routes to diff-adopt-profile (it names the skill or starts the flow); shows Dave's profile with **8 workflows**; **no thin-methodology warnings**; asks before writing |
| 0:12 | Adopt | Say yes; pick 1-2 workflows if offered a choice (meeting-intelligence is the stage pick) | Bundle saved under `04-Projects/DexDiff/beta/profile/adopted/davekilleen/`; generation produces a real tailored SKILL.md (read it, it must reference THIS vault's folders, not Dave's); adoption record at `System/.dex/adoptions/profiles/davekilleen.json` |
| 0:20 | Prove it | Run `/diff-list` in the same session | The adopted profile appears with its workflows |
| 0:22 | Waitlist | On the phone, submit a real test email on the page | "Done. Watch your inbox." (and `already` on second submit) |
| 0:24 | Reset + repeat the demo path | Delete `~/Dex`, re-clone, re-run bootstrap only | Same outputs, same timings, this is what muscle memory on stage feels like |
| 0:28 | Verdict | Fill in the table below |, |

## Record the evidence

```
bootstrap time:        ____ s   (target < 30s)
phrase -> profile:     ____ s   (target < 60s)
full adopt (1 wf):     ____ min (target < 8 min)
warnings seen:         none / list:
surprises:
```

## The abort rule (binary, no judgement calls on Tuesday)

Flip to waitlist-only mode (go-live checklist Appendix B: one line +
`./deploy-funnel.sh`) **Monday evening** if ANY of these happened in rehearsal:

1. The bootstrap failed or needed manual fixing on the clean machine.
2. The fetch showed anything other than 8 workflows with zero warnings.
3. Claude Code did not route the phrase to the skill, or generation produced
   something you would not want a stranger to see.
4. The stranger path (scan to adopted workflow) exceeded 10 minutes.
5. You were not able to run the rehearsal at all.

In waitlist mode Tuesday still works: the QR pitches, captures emails, and
Dave demos "set me up like Dave" live on his own second machine where it is
known-good. Honest, still impressive, zero live-stranger risk.

If NONE of the five fired: Tuesday goes live mode. Do not touch anything after
a green rehearsal, freeze the page, the installer, and production data until
after the talk.

## Tuesday morning micro-check (5 min, before leaving for the venue)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://heydex.ai/diff/like-dave/      # 200
curl -s https://heydex.ai/install-diff | head -1                                # #!/bin/bash
curl -s "https://api.heydex.ai/api/profile-bundle?handle=davekilleen" | head -c 80   # {"contractVersion":"2026-04-10"...
```

Any failure: flip Appendix B. The page itself never breaks in waitlist mode.

## If something fails DURING rehearsal

- Bootstrap 404: deploy-funnel.sh did not run or Caddy host changed, rerun
  checklist step 8.
- Bundle 404: visibility regressed or wrong handle, rerun checklist steps 5/7.
- Warnings about thin methodologies: the re-seed did not stick, rerun step 4.
- Claude Code does not pick the skill from the phrase: use the explicit
  command on stage instead (`/diff-adopt-profile @davekilleen`) and update the
  page copy to show the slash command first; that is a copy tweak, not an
  abort.
- Anything else: capture the exact output, fix, re-run the failed stage, and
  restart the 30-minute clock from 0. A rehearsal that needed a fix does not
  count as green until it passes clean end to end.
