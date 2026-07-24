import { v } from "convex/values";
import { internalMutation, internalQuery, query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireBetaUser, requireBetaViewer } from "./lib/beta";

const ADMIN_HANDLES = ["dave"];

async function listPublishedLoveLetters(ctx: any, args: any) {
  const limit = args.limit ?? 50;
  let results = await ctx.db
    .query("loveLetters")
    .withIndex("by_status_and_createdAt", (q: any) =>
      q.eq("status", "published")
    )
    .order("desc")
    .take(200);

  if (args.function_) results = results.filter((letter: any) => letter.function_ === args.function_);
  if (args.seniority) results = results.filter((letter: any) => letter.seniority === args.seniority);
  if (args.diffSlug) {
    results = results.filter(
      (letter: any) => letter.diffSlugs?.includes(args.diffSlug) ?? false
    );
  }
  if (args.handle) results = results.filter((letter: any) => letter.handle === args.handle);

  return results.slice(0, limit).map((letter: any) => ({
    handle: letter.handle,
    displayName: letter.displayName,
    photoUrl: letter.photoUrl,
    role: letter.role,
    function_: letter.function_,
    seniority: letter.seniority,
    company: letter.company,
    text: letter.text,
    createdAt: letter.createdAt,
    hasDiffs: letter.hasDiffs,
  }));
}

// Internal mutation called by the HTTP action after redeeming a connection code.
// Denormalizes user fields, checks for duplicates, populates diffSlugs from adoptions.
export const submit = internalMutation({
  args: {
    userId: v.id("users"),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireBetaUser(ctx, args.userId);
    // Check for existing love letter from this user
    const existing = await ctx.db
      .query("loveLetters")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      return { error: "You've already submitted a love letter" };
    }

    // Get the user record
    const user = await ctx.db.get(args.userId);
    if (!user || !user.handle) {
      return { error: "User not found or profile incomplete" };
    }

    // Photo fallback chain: Exa/LinkedIn -> Google OAuth -> null
    const photoUrl = user.photoUrl ?? user.image ?? undefined;

    // Check if user has published diffs
    const firstDiff = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", args.userId))
      .take(1);
    const hasDiffs = firstDiff.length > 0;

    // Get adopted diff slugs
    const adoptions = await ctx.db
      .query("adoptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .take(100);
    const diffSlugs = adoptions
      .filter((a) => !a.removed)
      .map((a) => a.diffSlug);

    await ctx.db.insert("loveLetters", {
      userId: args.userId,
      handle: user.handle,
      displayName: user.displayName ?? user.handle,
      photoUrl,
      role: user.role,
      function_: user.function_,
      seniority: user.seniority,
      company: user.company,
      text: args.text,
      status: "pending",
      createdAt: Date.now(),
      hasDiffs,
      diffSlugs: diffSlugs.length > 0 ? diffSlugs : undefined,
    });

    return { success: true };
  },
});

// Public query: published love letters with optional filters.
export const list = query({
  args: {
    function_: v.optional(v.string()),
    seniority: v.optional(v.string()),
    diffSlug: v.optional(v.string()),
    handle: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBetaViewer(ctx);
    return await listPublishedLoveLetters(ctx, args);
  },
});

export const listForBetaUser = internalQuery({
  args: {
    betaUserId: v.id("users"),
    function_: v.optional(v.string()),
    seniority: v.optional(v.string()),
    diffSlug: v.optional(v.string()),
    handle: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireBetaUser(ctx, args.betaUserId);
    return await listPublishedLoveLetters(ctx, args);
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireBetaViewer(ctx);
    if (!viewer) {
      return null;
    }

    const letter = await ctx.db
      .query("loveLetters")
      .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
      .unique();

    if (!letter) {
      return null;
    }

    return {
      _id: letter._id,
      text: letter.text,
      status: letter.status,
      createdAt: letter.createdAt,
      hasDiffs: letter.hasDiffs,
      diffSlugs: letter.diffSlugs,
    };
  },
});

// Admin mutation: moderate a love letter (publish, reject, unpublish).
export const moderate = mutation({
  args: {
    letterId: v.id("loveLetters"),
    status: v.union(
      v.literal("published"),
      v.literal("rejected"),
      v.literal("pending")
    ),
  },
  handler: async (ctx, args) => {
    await requireBetaViewer(ctx);
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || !user.handle || !ADMIN_HANDLES.includes(user.handle)) {
      throw new Error("Not authorized");
    }

    const letter = await ctx.db.get(args.letterId);
    if (!letter) {
      throw new Error("Love letter not found");
    }

    await ctx.db.patch(args.letterId, { status: args.status });
    return { success: true };
  },
});

// Admin query: all love letters regardless of status.
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireBetaViewer(ctx);
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || !user.handle || !ADMIN_HANDLES.includes(user.handle)) {
      throw new Error("Not authorized");
    }

    return await ctx.db
      .query("loveLetters")
      .order("desc")
      .take(200);
  },
});
