import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Find all users matching a domain — admin utility
export const findUsersByDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain))
      .take(50);

    return users.map((u) => ({
      _id: u._id,
      email: u.email,
      handle: u.handle,
      displayName: u.displayName,
      name: u.name,
      tokenIdentifier: u.tokenIdentifier,
      onboardingCompleted: u.onboardingCompleted,
      _creationTime: u._creationTime,
    }));
  },
});

// Find all users matching an email
export const findUsersByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .take(10);

    return users.map((u) => ({
      _id: u._id,
      email: u.email,
      handle: u.handle,
      displayName: u.displayName,
      name: u.name,
      tokenIdentifier: u.tokenIdentifier,
      onboardingCompleted: u.onboardingCompleted,
      _creationTime: u._creationTime,
    }));
  },
});

// Delete a specific user by ID — admin utility
export const deleteUser = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { error: "User not found" };
    await ctx.db.delete(args.userId);
    return { deleted: true, email: user.email, handle: user.handle };
  },
});
