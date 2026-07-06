import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

const ADOPTION_CONTRACT_VERSION = "2026-04-10";
const MAX_DIFF_IDS = 50;
const MAX_SOURCE_LENGTH = 120;
const DIFF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const DAILY_AUTHOR_WINDOW_MS = 24 * 60 * 60 * 1000;
const DAILY_AUTHOR_EVENT_LIMIT = 200;

function errorResult(reason: string) {
  return {
    ok: false as const,
    reason,
  };
}

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "");
}

function validateDiffIds(diffIds: string[]) {
  if (diffIds.length === 0) {
    return errorResult("empty_diff_ids");
  }

  if (diffIds.length > MAX_DIFF_IDS) {
    return errorResult("too_many_diff_ids");
  }

  const seen = new Set<string>();
  for (const diffId of diffIds) {
    if (!DIFF_ID_PATTERN.test(diffId)) {
      return errorResult("invalid_diff_id");
    }

    if (seen.has(diffId)) {
      return errorResult("duplicate_diff_ids");
    }

    seen.add(diffId);
  }

  return null;
}

function sortedDiffIds(diffIds: string[]) {
  return [...diffIds].sort();
}

function arraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function diffKey(authorHandle: string, diffId: string) {
  return `${authorHandle}\u0000${diffId}`;
}

async function hasRecentDuplicate(
  ctx: MutationCtx,
  authorHandle: string,
  diffIds: string[],
  source: string,
  since: number
) {
  /*
   * The existing by_authorHandle_and_createdAt index gives the right access
   * pattern for both replay detection and the daily ceiling: one author's
   * bounded recent audit rows. We then filter source and sorted diffIds in
   * memory rather than adding an index that tries to encode array contents.
   */
  const recentEvents = await ctx.db
    .query("adoptionEvents")
    .withIndex("by_authorHandle_and_createdAt", (q) =>
      q.eq("authorHandle", authorHandle).gte("createdAt", since)
    )
    .collect();

  return recentEvents.some((event) =>
    event.source === source && arraysEqual(sortedDiffIds(event.diffIds), diffIds)
  );
}

async function recentAuthorEventCount(ctx: MutationCtx, authorHandle: string, since: number) {
  const recentEvents = await ctx.db
    .query("adoptionEvents")
    .withIndex("by_authorHandle_and_createdAt", (q) =>
      q.eq("authorHandle", authorHandle).gte("createdAt", since)
    )
    .take(DAILY_AUTHOR_EVENT_LIMIT);

  return recentEvents.length;
}

export const recordFromDesktop = internalMutation({
  args: {
    authorHandle: v.string(),
    diffIds: v.array(v.string()),
    source: v.string(),
    contractVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const authorHandle = normalizeHandle(args.authorHandle);
    const source = args.source.trim();

    if (args.contractVersion !== ADOPTION_CONTRACT_VERSION) {
      return errorResult("unsupported_contract_version");
    }

    if (!authorHandle) {
      return errorResult("invalid_author_handle");
    }

    if (!source || source.length > MAX_SOURCE_LENGTH) {
      return errorResult("invalid_source");
    }

    const diffIdError = validateDiffIds(args.diffIds);
    if (diffIdError) {
      return diffIdError;
    }

    const diffIds = sortedDiffIds(args.diffIds);
    const now = Date.now();

    if (
      await hasRecentDuplicate(
        ctx,
        authorHandle,
        diffIds,
        source,
        now - DEDUPE_WINDOW_MS
      )
    ) {
      return {
        ok: true as const,
        recorded: 0,
      };
    }

    const author = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", authorHandle))
      .unique();

    if (!author) {
      return errorResult("author_not_found");
    }

    const diffs = [];
    for (const diffId of diffIds) {
      const diff = await ctx.db
        .query("diffs")
        .withIndex("by_authorHandle_and_diffId", (q) =>
          q.eq("authorHandle", authorHandle).eq("diffId", diffId)
        )
        .unique();

      if (!diff || diff.authorId !== author._id || diff.status !== "published") {
        return errorResult("diff_not_found_or_unpublished");
      }

      diffs.push(diff);
    }

    const recentEvents = await recentAuthorEventCount(
      ctx,
      authorHandle,
      now - DAILY_AUTHOR_WINDOW_MS
    );
    if (recentEvents >= DAILY_AUTHOR_EVENT_LIMIT) {
      await ctx.db.insert("adoptionEvents", {
        authorHandle,
        diffIds,
        source,
        contractVersion: args.contractVersion,
        createdAt: now,
        counted: false,
        reason: "daily_author_ceiling",
      });

      return {
        ok: true as const,
        recorded: 0,
      };
    }

    for (const diff of diffs) {
      await ctx.db.patch(diff._id, {
        adoptionCount: diff.adoptionCount + 1,
      });
    }

    await ctx.db.insert("adoptionEvents", {
      authorHandle,
      diffIds,
      source,
      contractVersion: args.contractVersion,
      createdAt: now,
      counted: true,
    });

    return {
      ok: true as const,
      recorded: diffIds.length,
    };
  },
});

// Admin repair tool only: invoke with `npx convex run adoptionEvents:recomputeCounts`.
// This is intentionally an internalMutation and is not routed over HTTP.
export const recomputeCounts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const diffs = await ctx.db.query("diffs").collect();
    const countsByDiff = new Map<string, number>();
    for (const diff of diffs) {
      countsByDiff.set(diffKey(diff.authorHandle, diff.diffId), 0);
    }

    const events = await ctx.db.query("adoptionEvents").collect();
    let countedEvents = 0;
    let ignoredEvents = 0;

    for (const event of events) {
      if (event.counted === false) {
        ignoredEvents += 1;
        continue;
      }

      countedEvents += 1;
      for (const diffId of event.diffIds) {
        const key = diffKey(event.authorHandle, diffId);
        const currentCount = countsByDiff.get(key);
        if (currentCount !== undefined) {
          countsByDiff.set(key, currentCount + 1);
        }
      }
    }

    let updated = 0;
    for (const diff of diffs) {
      const nextCount =
        countsByDiff.get(diffKey(diff.authorHandle, diff.diffId)) ?? 0;
      if (diff.adoptionCount !== nextCount) {
        await ctx.db.patch(diff._id, { adoptionCount: nextCount });
        updated += 1;
      }
    }

    return {
      diffsScanned: diffs.length,
      eventsScanned: events.length,
      countedEvents,
      ignoredEvents,
      updated,
    };
  },
});
