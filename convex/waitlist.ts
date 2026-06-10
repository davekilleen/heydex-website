import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Waitlist capture for the QR funnel (secondary CTA on /diff/like-dave/
// and the whole page's primary CTA in waitlist fallback mode).
// Called only from the HTTP action in http.ts, which validates and
// rate-limits. Idempotent on email.
export const join = internalMutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();

    const existing = await ctx.db
      .query("waitlist")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (existing) {
      return { ok: true, already: true };
    }

    await ctx.db.insert("waitlist", {
      email,
      source: args.source,
      createdAt: Date.now(),
    });

    return { ok: true, already: false };
  },
});
