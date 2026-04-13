import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireViewerForMutation } from "./viewer";

const CLI_CODE_TTL_MS = 30 * 60 * 1000;
const CLI_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function generateCliSessionToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// Generate a one-time connection code for the CLI device flow.
// Called from the web after the user logs in.
// Returns a 6-character code the user pastes into their terminal.
export const generateCode = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireViewerForMutation(ctx);

    // Generate a random 6-character alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    // Store the code with 30-minute expiry
    await ctx.db.insert("connectionCodes", {
      code,
      userId: user._id,
      userHandle: user.handle,
      expiresAt: Date.now() + CLI_CODE_TTL_MS,
      redeemed: false,
    });

    // Schedule cleanup after 30 minutes
    await ctx.scheduler.runAfter(CLI_CODE_TTL_MS, internal.connect.expireCode, { code });

    return { code, expiresInSeconds: CLI_CODE_TTL_MS / 1000 };
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

    const sessionToken = generateCliSessionToken();
    await ctx.db.insert("cliSessions", {
      sessionToken,
      userId: user._id,
      createdAt: Date.now(),
      expiresAt: Date.now() + CLI_SESSION_TTL_MS,
      lastUsedAt: Date.now(),
    });

    return {
      handle: user.handle ?? null,
      displayName: user.displayName,
      sessionToken,
      email: user.email,
    };
  },
});

export const resolveCliSession = internalMutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("cliSessions")
      .withIndex("by_sessionToken", (q) =>
        q.eq("sessionToken", args.sessionToken)
      )
      .unique();

    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      await ctx.db.delete(session._id);
      return null;
    }

    await ctx.db.patch(session._id, { lastUsedAt: Date.now() });
    return await ctx.db.get(session.userId);
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
