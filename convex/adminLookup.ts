import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      _id: user._id,
      email: user.email,
      handle: user.handle,
      displayName: user.displayName,
      name: user.name,
      tokenIdentifier: user.tokenIdentifier,
      onboardingCompleted: user.onboardingCompleted,
      domain: user.domain,
      _creationTime: user._creationTime,
    };
  },
});
