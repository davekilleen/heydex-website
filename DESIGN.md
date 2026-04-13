# heydex-website Design Entry

This file is the repo-local design entrypoint for `heydex-website`.

It is not the canonical Dex design source.

Canonical design docs now live in:
- `/Users/dave.killeen/dex/product/design/Dex.Theme.md`
- `/Users/dave.killeen/dex/product/design/Dex.Web.Public.md`
- `/Users/dave.killeen/dex/product/design/Dex.Web.Dev.md`
- `/Users/dave.killeen/dex/product/design/Dex.Desktop.md`
- `/Users/dave.killeen/dex/product/design/Dex.Mobile.md`
- `/Users/dave.killeen/dex/product/design/Dex.CLI.md`

---

## Which File To Use

For public/editorial website surfaces in this repo, use:
- `Dex.Theme.md`
- `Dex.Web.Public.md`

Examples:
- `/`
- public explainers
- editorial landing pages
- public diff/community pages

For hosted product-like or inspectable web flows in this repo, use:
- `Dex.Theme.md`
- `Dex.Web.Dev.md`

Examples:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- authenticated or setup-oriented hosted surfaces

---

## Repo-Specific Guidance

This repo contains both:
- public/editorial surfaces
- hosted product surfaces

Do not collapse them into one undifferentiated visual treatment.

Public/editorial routes should feel:
- more editorial
- more spacious
- more expressive
- more atmosphere-tolerant

Hosted/product-like routes should feel:
- clearer
- calmer
- more inspectable
- more structurally explicit

Both should still feel recognizably Dex.

---

## Route Ownership Reminder

React-owned routes:
- `/connect/`
- `/diff/`
- `/diff/profile/`
- `/diff/review/`
- `/diff/@:handle/`

Static/editorial routes:
- `/`
- `/privacy/`
- `/diff/community/`
- `/diff/company/`
- `/diff/love-letters/`
- `/diff/roadmap/`
- `/diff/welcome/`
- `/diff/admin/`
- `/diff/@dave/`

Do not let static overlays reclaim a React-owned path.

---

## Local Design Rules For This Repo

- keep public trust signals visible early on public-facing pages
- keep setup and review flows low-anxiety and inspectable
- preserve the Dex black-and-rose visual language
- use page-specific briefs only after loading the canonical theme plus the correct web adapter

If a future page-specific brief is needed for this repo, create a separate file instead of turning this bridge file back into the master design source.
