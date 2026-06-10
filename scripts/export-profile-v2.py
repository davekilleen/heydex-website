#!/usr/bin/env python3
"""Export Dave's real v2 methodology YAMLs from the vault into the repo seed payload.

Reads the vault READ-ONLY. Writes only into seed-data/dave-profile-v2/.

Why this exists: production was seeded on 2026-04-07 from
seed-data/dave-diffs.json, whose "methodology" fields are ~227-character v1
summaries, too thin for the v2 promise (the adopter's AI regenerates the
workflow from the methodology). The real v2 YAMLs live in the vault's DexDiff
draft area. This script exports a deduplicated, curated set plus a manifest
that scripts/reseed-v2.cjs consumes.

Curation (2026-06-10, from the end-to-end review's dedup guidance):
  - one pick per duplicate cluster, newest generation run preferred
  - 8 workflows that tell the "set me up like Dave" story
  - skipped duplicates are recorded in the manifest for the audit trail

Usage:
    python3 scripts/export-profile-v2.py [--vault /path/to/Vault]

Requires PyYAML (the dex-core worktree venv has it):
    /Users/dave.killeen/dex/product/dex-core-dexdiff-funnel/.venv-funnel/bin/python scripts/export-profile-v2.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = REPO_ROOT / "seed-data" / "dave-profile-v2"

# diffId -> vault-relative source. One pick per duplicate cluster.
PICKS = {
    "meeting-intelligence": "04-Projects/DexDiff/beta/profile/meeting-intelligence.yaml",
    "deal-intelligence": "04-Projects/DexDiff/beta/profile/deal-intelligence.yaml",
    "relationship-intelligence": "04-Projects/DexDiff/beta/profile/relationship-intelligence.yaml",
    "operating-rhythm": "04-Projects/DexDiff/beta/profile/operating-rhythm.yaml",
    "content-thought-leadership": "04-Projects/DexDiff/beta/profile/content-thought-leadership.yaml",
    "compound-learning": "04-Projects/DexDiff/beta/profile/compound-learning.yaml",
    "agent-orchestration": "04-Projects/DexDiff/beta/profile/agent-orchestration.yaml",
    "market-intelligence": "04-Projects/DexDiff/beta/profile/market-intelligence.yaml",
}

# Documented dedup decisions (cluster -> skipped variants)
SKIPPED_DUPLICATES = {
    "agent-orchestration": [
        "profile/agentic-orchestration.yaml (older, smaller)",
        "profile/multi-agent-orchestration.yaml (16:10 run, superseded)",
        "diffs/agentic-orchestration.yaml (same as profile copy)",
    ],
    "operating-rhythm": [
        "profile/daily-operating-rhythm.yaml (16:10 run, superseded)",
        "profile/planning-rhythm.yaml (older 14:29 copy)",
        "diffs/planning-rhythm.yaml (same as profile copy)",
    ],
    "deal-intelligence": [
        "profile/deal-command-center.yaml (overlapping job, weaker description)",
        "diffs/deal-intelligence.yaml (older, smaller)",
    ],
    "relationship-intelligence": [
        "profile/people-intelligence.yaml (subsumed)",
        "diffs/people-intelligence.yaml (same as profile copy)",
    ],
    "content-thought-leadership": ["profile/content-engine.yaml (older 14:29 copy)"],
    "market-intelligence": ["profile/intelligence-gathering.yaml (older 14:29 copy)"],
    "not-exported": [
        "profile/product-ideation.yaml (strong but cut to keep the profile at 8)",
        "profile/workflow-distribution.yaml (meta-workflow, confusing first adopt)",
        "profile/autonomous-safety.yaml (cut to keep the profile at 8)",
        "diffs/meeting-prep.yaml (subsumed by meeting-intelligence)",
        "diffs/meeting-intelligence.yaml (older, smaller than profile copy)",
        "diffs/content-engine.yaml / diffs/intelligence-gathering.yaml (older copies)",
    ],
}

PROFILE_USER = {
    "handle": "davekilleen",
    "displayName": "Dave Killeen",
    "role": "Field CPO, EMEA",
    "function": "Product",
    "company": "Pendo",
    "linkedinUrl": "https://linkedin.com/in/davekilleen",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", default="/Users/dave.killeen/Vault")
    args = parser.parse_args()
    vault = Path(args.vault)

    if not vault.is_dir():
        print(f"Vault not found at {vault}", file=sys.stderr)
        return 1

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    diffs = []
    problems = []

    for diff_id, relative in PICKS.items():
        source = vault / relative
        if not source.is_file():
            problems.append(f"{diff_id}: missing source {relative}")
            continue

        text = source.read_text(encoding="utf-8")

        # Validation gates
        if "/Users/" in text:
            problems.append(f"{diff_id}: contains an absolute /Users/ path, sanitize before seeding")
        try:
            parsed = yaml.safe_load(text)
        except yaml.YAMLError as error:
            problems.append(f"{diff_id}: YAML parse failed: {error}")
            continue
        if str(parsed.get("dexdiff_schema")) != "2.0":
            problems.append(f"{diff_id}: dexdiff_schema is not 2.0")
        if parsed.get("id") != diff_id:
            problems.append(f"{diff_id}: YAML id field is {parsed.get('id')!r}")

        target = OUTPUT_DIR / f"{diff_id}.yaml"
        target.write_text(text, encoding="utf-8")

        matching = parsed.get("matching") or {}
        diffs.append(
            {
                "diffId": diff_id,
                "name": parsed.get("name", diff_id),
                "description": (parsed.get("description") or "").strip(),
                "tags": parsed.get("tags") or [],
                "roles": matching.get("roles") or [],
                "integrations": matching.get("enhanced_by") or [],
                "methodologyFile": f"seed-data/dave-profile-v2/{diff_id}.yaml",
                "methodologyBytes": len(text.encode("utf-8")),
                "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                "sourceVaultPath": relative,
            }
        )

    manifest = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "user": PROFILE_USER,
        "diffs": diffs,
        "dedupDecisions": SKIPPED_DUPLICATES,
        "notes": [
            "methodology fields are seeded as the FULL YAML text of each file, verbatim",
            "legacy v1 production diffIds not carried forward: relationship-compounding, "
            "weekly-operating-rhythm, accountability-cracks, thought-leadership, "
            "self-improving-system (superseded by the v2 set; archive them at go-live)",
        ],
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Exported {len(diffs)} workflows to {OUTPUT_DIR.relative_to(REPO_ROOT)}/")
    for diff in diffs:
        print(f"  {diff['diffId']:<28} {diff['methodologyBytes']:>7,} bytes  {diff['name']}")
    if problems:
        print("\nPROBLEMS:")
        for problem in problems:
            print(f"  ! {problem}")
        return 1
    print("\nAll validation gates passed (YAML parses, schema 2.0, ids match, no /Users/ leaks).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
