import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// Generate a one-time connection code for the CLI device flow.
// Called from the web after the user logs in.
// Returns a 6-character code the user pastes into their terminal.
export const generateCode = mutation({
  args: {},
  handler: async (ctx) => {
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

    // Generate a random 6-character alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    // Store the code with 5-minute expiry
    await ctx.db.insert("connectionCodes", {
      code,
      userId: user._id,
      userHandle: user.handle,
      expiresAt: Date.now() + 5 * 60 * 1000,
      redeemed: false,
    });

    // Schedule cleanup after 5 minutes
    await ctx.scheduler.runAfter(5 * 60 * 1000, internal.connect.expireCode, { code });

    return { code, expiresInSeconds: 300 };
  },
});

// Exchange a connection code for a user handle + token identifier.
// Called from the CLI via HTTP endpoint.
// Returns the user info needed to authenticate future CLI requests.
export const redeemCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const codeDoc = await ctx.db
      .query("connectionCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code.toUpperCase()))
      .unique();

    if (!codeDoc) {
      return { error: "Invalid code" };
    }

    if (codeDoc.redeemed) {
      return { error: "Code already used" };
    }

    if (Date.now() > codeDoc.expiresAt) {
      return { error: "Code expired" };
    }

    // Mark as redeemed
    await ctx.db.patch(codeDoc._id, { redeemed: true });

    // Get the user
    const user = await ctx.db.get(codeDoc.userId);
    if (!user) {
      return { error: "User not found" };
    }

    return {
      handle: user.handle,
      displayName: user.displayName,
      tokenIdentifier: user.tokenIdentifier,
    };
  },
});

// Internal: expire a code after timeout
export const expireCode = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const codeDoc = await ctx.db
      .query("connectionCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();

    if (codeDoc && !codeDoc.redeemed) {
      await ctx.db.delete(codeDoc._id);
    }
  },
});
