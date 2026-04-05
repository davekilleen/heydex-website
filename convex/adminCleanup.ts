import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Delete all diffs by a given authorHandle
export const deleteDiffsByAuthor = internalMutation({
  args: { authorHandle: v.string() },
  handler: async (ctx, args) => {
    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId")
      .take(100);

    const toDelete = diffs.filter((d) => d.authorHandle === args.authorHandle);
    for (const diff of toDelete) {
      await ctx.db.delete(diff._id);
    }

    return { deleted: toDelete.length, handle: args.authorHandle };
  },
});
