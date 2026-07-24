import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import {
  getBetaViewerAccess,
  normalizeBetaEmail,
  requireBetaViewer,
} from "./lib/beta";

const BETA_ADMIN_EMAILS = new Set([
  "davekilleen@gmail.com",
  "dave.killeen@pendo.io",
]);

const INITIAL_BETA_EMAILS = [
  "davekilleen@gmail.com",
  "dave.killeen@pendo.io",
  "sam.jefferies@pendo.io",
  "laurence.judah@pendo.io",
  "matt@mattlemay.com",
  "martin@martineriksson.com",
] as const;

async function requireBetaAdmin(ctx: any) {
  const viewer = await requireBetaViewer(ctx);
  if (!viewer) {
    throw new Error("Not authenticated");
  }
  const email = normalizeBetaEmail(
    viewer.identity.email ?? viewer.user.email ?? "",
  );
  if (!BETA_ADMIN_EMAILS.has(email)) {
    throw new Error("Not authorized");
  }
  return { viewer, email };
}

async function upsertAllowlistEmail(
  ctx: any,
  args: { email: string; addedBy: string; note?: string },
) {
  const email = normalizeBetaEmail(args.email);
  const existing = await ctx.db
    .query("betaAllowlist")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      addedBy: args.addedBy,
      addedAt: Date.now(),
      note: args.note,
    });
    return { email, created: false };
  }

  await ctx.db.insert("betaAllowlist", {
    email,
    addedBy: args.addedBy,
    addedAt: Date.now(),
    note: args.note,
  });
  return { email, created: true };
}

export const viewerAccess = query({
  args: {},
  handler: async (ctx) => {
    const access = await getBetaViewerAccess(ctx);
    return {
      authenticated: access.authenticated,
      allowed: access.allowed,
    };
  },
});

export const assertViewerAccess = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireBetaViewer(ctx);
    return { allowed: true };
  },
});

export const admitEmail = mutation({
  args: {
    email: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { email: addedBy } = await requireBetaAdmin(ctx);
    return await upsertAllowlistEmail(ctx, {
      email: args.email,
      addedBy,
      note: args.note,
    });
  },
});

async function removeEmailAndInvalidate(ctx: any, rawEmail: string) {
  const email = normalizeBetaEmail(rawEmail);
  const entry = await ctx.db
    .query("betaAllowlist")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();

  if (entry) await ctx.db.delete(entry._id);

  const matchingUsers = (await ctx.db.query("users").collect()).filter(
    (user: any) => user.email && normalizeBetaEmail(user.email) === email,
  );
  let invalidatedCliSessions = 0;
  let invalidatedReviewSessions = 0;

  for (const user of matchingUsers) {
    const [cliSessions, reviewSessions, connectionCodes, adoptGrants] =
      await Promise.all([
        ctx.db
          .query("cliSessions")
          .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
          .collect(),
        ctx.db
          .query("reviewSessions")
          .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
          .collect(),
        ctx.db
          .query("connectionCodes")
          .filter((q: any) => q.eq(q.field("userId"), user._id))
          .collect(),
        ctx.db
          .query("adoptGrants")
          .filter((q: any) => q.eq(q.field("granterUserId"), user._id))
          .collect(),
      ]);

    for (const session of cliSessions) {
      await ctx.db.delete(session._id);
      invalidatedCliSessions += 1;
    }
    for (const session of reviewSessions) {
      await ctx.db.delete(session._id);
      invalidatedReviewSessions += 1;
    }
    for (const code of connectionCodes) await ctx.db.delete(code._id);
    for (const grant of adoptGrants) await ctx.db.delete(grant._id);
  }

  return {
    email,
    removed: entry !== null,
    invalidatedCliSessions,
    invalidatedReviewSessions,
  };
}

export const removeEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireBetaAdmin(ctx);
    return await removeEmailAndInvalidate(ctx, args.email);
  },
});

export const removeEmailForTest = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await removeEmailAndInvalidate(ctx, args.email);
  },
});

export const seedAllowlist = internalMutation({
  args: {},
  handler: async (ctx) => {
    const results = [];
    for (const email of INITIAL_BETA_EMAILS) {
      results.push(
        await upsertAllowlistEmail(ctx, {
          email,
          addedBy: "seed:2026-07-24",
          note: "Initial DexDiff private beta cohort",
        }),
      );
    }
    return results;
  },
});

export const exportAllowlist = internalQuery({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("betaAllowlist").collect();
    return entries.map((entry) => entry.email).sort();
  },
});
