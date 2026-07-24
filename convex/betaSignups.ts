import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import {
  getViewerOrNull,
  requireViewerForMutation,
} from "./viewer";

const usageLevelValidator = v.union(
  v.literal("not_installed"),
  v.literal("tried_it"),
  v.literal("weekly"),
  v.literal("daily")
);

const customizationValidator = v.union(
  v.literal("stock"),
  v.literal("few_tweaks"),
  v.literal("customized"),
  v.literal("unrecognizable")
);

function optionalTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const mine = query({
  args: {},
  handler: async (ctx): Promise<Doc<"betaSignups"> | null> => {
    const viewer = await getViewerOrNull(ctx);
    if (!viewer) {
      return null;
    }

    return await ctx.db
      .query("betaSignups")
      .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
      .unique();
  },
});

export const submit = mutation({
  args: {
    usageLevel: usageLevelValidator,
    liked: v.optional(v.string()),
    frustrations: v.optional(v.string()),
    customization: customizationValidator,
    linkedinUrl: v.optional(v.string()),
    linkedinUsername: v.optional(v.string()),
    enrichedTitle: v.optional(v.string()),
    enrichedCompany: v.optional(v.string()),
    enrichedIndustry: v.optional(v.string()),
    enrichedPhotoUrl: v.optional(v.string()),
    enrichedSummary: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"betaSignups">> => {
    const viewer = await requireViewerForMutation(ctx);
    const email = optionalTrimmed(
      viewer.user.email ?? viewer.identity.email
    )?.toLowerCase();

    if (!email) {
      throw new Error("Your Google account did not provide an email address.");
    }

    const existing = await ctx.db
      .query("betaSignups")
      .withIndex("by_userId", (q) => q.eq("userId", viewer.userId))
      .unique();

    const signup = {
      userId: viewer.userId,
      email,
      name: optionalTrimmed(
        viewer.user.displayName ??
          viewer.user.name ??
          viewer.identity.name
      ),
      usageLevel: args.usageLevel,
      liked: optionalTrimmed(args.liked),
      frustrations: optionalTrimmed(args.frustrations),
      customization: args.customization,
      linkedinUrl: optionalTrimmed(args.linkedinUrl),
      linkedinUsername: optionalTrimmed(args.linkedinUsername),
      enrichedTitle: optionalTrimmed(args.enrichedTitle),
      enrichedCompany: optionalTrimmed(args.enrichedCompany),
      enrichedIndustry: optionalTrimmed(args.enrichedIndustry),
      enrichedPhotoUrl: optionalTrimmed(args.enrichedPhotoUrl),
      enrichedSummary: optionalTrimmed(args.enrichedSummary),
      source: optionalTrimmed(args.source) ?? "beta-page",
    };

    let signupId: Id<"betaSignups">;
    if (existing) {
      await ctx.db.patch(existing._id, signup);
      signupId = existing._id;
    } else {
      signupId = await ctx.db.insert("betaSignups", {
        ...signup,
        confirmationEmailSent: false,
        createdAt: Date.now(),
      });
    }

    if (!existing?.confirmationEmailSent) {
      await ctx.scheduler.runAfter(
        0,
        internal.betaSignups.sendConfirmation,
        { signupId }
      );
    }

    return signupId;
  },
});

export const getSignup = internalQuery({
  args: { signupId: v.id("betaSignups") },
  handler: async (ctx, args): Promise<Doc<"betaSignups"> | null> => {
    return await ctx.db.get(args.signupId);
  },
});

export const markConfirmationEmailSent = internalMutation({
  args: { signupId: v.id("betaSignups") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.signupId, { confirmationEmailSent: true });
  },
});

export const sendConfirmation = internalAction({
  args: { signupId: v.id("betaSignups") },
  handler: async (ctx, args) => {
    const signup: Doc<"betaSignups"> | null = await ctx.runQuery(
      internal.betaSignups.getSignup,
      { signupId: args.signupId }
    );

    if (!signup) {
      console.error(`sendConfirmation: signup ${args.signupId} not found`);
      return;
    }

    if (signup.confirmationEmailSent) {
      console.log(`sendConfirmation: already sent for ${signup.userId}`);
      return;
    }

    const firstName = signup.name?.split(" ")[0] ?? "";
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";
    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="padding:0 0 32px 0;"><span style="font-size:28px;color:#FF3870;">✳</span></td></tr>
<tr><td style="color:#f0f0f0;font-size:16px;line-height:1.6;">
<p style="margin:0 0 20px 0;">${greeting}</p>
<p style="margin:0 0 20px 0;">Thanks for requesting beta access — you're on the list.</p>
<p style="margin:0 0 20px 0;">We'll be in touch soon — the betas for the Dex Desktop app and DexDiff are opening up shortly.</p>
<p style="margin:0 0 32px 0;">Thanks for helping shape what comes next.<br><br>Dave</p>
</td></tr>
<tr><td style="padding:32px 0 0 0;border-top:1px solid #1a1a1a;">
<p style="color:#666;font-size:13px;line-height:1.5;margin:0;">You're receiving this because you requested Dex beta access at heydex.ai.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim();

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `beta-signup-${signup._id}`,
      },
      body: JSON.stringify({
        from: "Dave from Dex <dave@heydex.ai>",
        to: [signup.email],
        subject: "You're on the Dex beta list",
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }

    await ctx.runMutation(
      internal.betaSignups.markConfirmationEmailSent,
      { signupId: signup._id }
    );

    console.log(`Beta confirmation email sent to ${signup.email}`);
  },
});
