import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// V2 re-seed mutations (2026-06 funnel go-live).
//
// Differences from the legacy seed.ts:
//   - seeds diffs under an EXISTING registered user found by handle
//     (never creates a user — the legacy seedDave created an orphan user
//     row with tokenIdentifier "seed:dave" that was never linked to the
//     real account)
//   - methodology is expected to be the FULL v2 YAML text, passed as a
//     real JSON argument by scripts/reseed-v2.cjs (the legacy script
//     interpolated methodology into a shell string, which silently
//     mangles multi-line YAML — that is how production ended up with
//     227-character summaries)
//
// All three are internalMutations: callable only via `npx convex run`
// by someone with deploy credentials, never from the public API.
// ---------------------------------------------------------------------------

export const seedProfileDiff = internalMutation({
  args: {
    handle: v.string(),
    diffId: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) {
      throw new Error(
        `No user with handle "${args.handle}" — connect/rename the real ` +
          "account first (this mutation never creates users)."
      );
    }

    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.handle).eq("diffId", args.diffId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        authorId: user._id,
        name: args.name,
        description: args.description,
        methodology: args.methodology,
        tags: args.tags,
        roles: args.roles,
        integrations: args.integrations,
        status: "published",
        publishedAt: existing.publishedAt ?? Date.now(),
      });
      return {
        action: "updated",
        diffId: args.diffId,
        methodologyChars: args.methodology.length,
      };
    }

    await ctx.db.insert("diffs", {
      diffId: args.diffId,
      authorId: user._id,
      authorHandle: args.handle,
      name: args.name,
      description: args.description,
      methodology: args.methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
      basedOn: undefined,
      adoptionCount: 0,
      activeUserCount: 0,
      status: "published",
      publishedAt: Date.now(),
    });

    return {
      action: "created",
      diffId: args.diffId,
      methodologyChars: args.methodology.length,
    };
  },
});

export const setProfileVisibility = internalMutation({
  args: {
    handle: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("colleagues"),
      v.literal("public")
    ),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) {
      throw new Error(`No user with handle "${args.handle}"`);
    }

    await ctx.db.patch(user._id, { visibility: args.visibility });
    return { handle: args.handle, visibility: args.visibility };
  },
});

// Archive every published diff under a handle (used to retire the legacy
// v1-summary diffs seeded under the orphan "dave" user). Reversible: pass
// restore: true to re-publish them.
export const archiveDiffsByHandle = internalMutation({
  args: {
    handle: v.string(),
    restore: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const fromStatus = args.restore ? "archived" : "published";
    const toStatus = args.restore ? "published" : "archived";

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) => q.eq("authorHandle", args.handle))
      .collect();

    const changed: string[] = [];
    for (const diff of diffs) {
      if (diff.status === fromStatus) {
        await ctx.db.patch(diff._id, { status: toStatus });
        changed.push(diff.diffId);
      }
    }

    return { handle: args.handle, toStatus, changed };
  },
});
