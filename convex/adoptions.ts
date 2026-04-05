import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// Record an adoption (requires auth)
export const record = mutation({
  args: {
    authorHandle: v.string(),
    diffSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      throw new Error("User not found — register first");
    }

    // Find the diff
    const diff = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.authorHandle).eq("diffId", args.diffSlug)
      )
      .unique();

    if (!diff) {
      throw new Error("Diff not found");
    }

    // Check if already adopted
    const existing = await ctx.db
      .query("adoptions")
      .withIndex("by_userId_and_diffId", (q) =>
        q.eq("userId", user._id).eq("diffId", diff._id)
      )
      .unique();

    if (existing && !existing.removed) {
      // Already adopted, update lastActiveAt
      await ctx.db.patch(existing._id, {
        lastActiveAt: Date.now(),
      });
      return existing._id;
    }

    if (existing && existing.removed) {
      // Re-adopt
      await ctx.db.patch(existing._id, {
        removed: false,
        adoptedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      // Increment adoption count
      await ctx.db.patch(diff._id, {
        adoptionCount: diff.adoptionCount + 1,
        activeUserCount: diff.activeUserCount + 1,
      });
      return existing._id;
    }

    // New adoption
    const adoptionId = await ctx.db.insert("adoptions", {
      userId: user._id,
      diffId: diff._id,
      authorHandle: args.authorHandle,
      diffSlug: args.diffSlug,
      adoptedAt: Date.now(),
      lastActiveAt: Date.now(),
      removed: false,
    });

    // Increment adoption count on the diff
    await ctx.db.patch(diff._id, {
      adoptionCount: diff.adoptionCount + 1,
      activeUserCount: diff.activeUserCount + 1,
    });

    return adoptionId;
  },
});

// Record removal of an adopted diff
export const remove = mutation({
  args: {
    authorHandle: v.string(),
    diffSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const diff = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.authorHandle).eq("diffId", args.diffSlug)
      )
      .unique();

    if (!diff) return null;

    const adoption = await ctx.db
      .query("adoptions")
      .withIndex("by_userId_and_diffId", (q) =>
        q.eq("userId", user._id).eq("diffId", diff._id)
      )
      .unique();

    if (!adoption || adoption.removed) return null;

    await ctx.db.patch(adoption._id, { removed: true });

    // Decrement counts
    await ctx.db.patch(diff._id, {
      adoptionCount: Math.max(0, diff.adoptionCount - 1),
      activeUserCount: Math.max(0, diff.activeUserCount - 1),
    });

    return adoption._id;
  },
});

// Get my adoptions
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) return [];

    const adoptions = await ctx.db
      .query("adoptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(100);

    return adoptions
      .filter((a) => !a.removed)
      .map((a) => ({
        authorHandle: a.authorHandle,
        diffSlug: a.diffSlug,
        adoptedAt: a.adoptedAt,
        lastActiveAt: a.lastActiveAt,
      }));
  },
});
