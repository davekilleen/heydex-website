import { v } from "convex/values";
import { query } from "./_generated/server";

// Get a user's public profile with their published diffs
export const get = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) return null;

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", user._id))
      .take(50);

    const publishedDiffs = diffs
      .filter((d) => d.status === "published")
      .map((d) => ({
        diffId: d.diffId,
        name: d.name,
        description: d.description,
        tags: d.tags,
        roles: d.roles,
        adoptionCount: d.adoptionCount,
      }));

    return {
      handle: user.handle,
      displayName: user.displayName,
      role: user.role,
      title: user.title,
      company: user.company,
      function_: user.function_,
      seniority: user.seniority,
      summary: user.summary,
      photoUrl: user.photoUrl,
      linkedinUrl: user.linkedinUrl,
      diffs: publishedDiffs,
      totalAdoptions: publishedDiffs.reduce((sum, d) => sum + d.adoptionCount, 0),
    };
  },
});
