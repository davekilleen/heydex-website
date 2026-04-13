import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { requireViewerForMutation } from "./viewer";

export const getUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db.get(args.userId);
  },
});

export const markWelcomeEmailSent = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { welcomeEmailSent: true });
  },
});

export const sendWelcome = internalAction({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user: Doc<"users"> | null = await ctx.runQuery(
      internal.email.getUser,
      { userId: args.userId }
    );

    if (!user) {
      console.error(`sendWelcome: user ${args.userId} not found`);
      return;
    }

    if (user.welcomeEmailSent) {
      console.log(`sendWelcome: already sent for ${args.userId}`);
      return;
    }

    if (!user.email) {
      console.error(`sendWelcome: no email for user ${args.userId}`);
      return;
    }

    const firstName = user.displayName?.split(" ")[0] ?? "";
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

<!-- Logo -->
<tr><td style="padding:0 0 32px 0;">
  <span style="font-size:28px;color:#FF3870;">✳</span>
</td></tr>

<!-- Body -->
<tr><td style="color:#f0f0f0;font-size:16px;line-height:1.6;">

<p style="margin:0 0 20px 0;">${greeting}</p>

<p style="margin:0 0 20px 0;">You're one of the first people to lean into Dex, and that means a lot to us.</p>

<p style="margin:0 0 20px 0;">For the last few years, Dave has been obsessed with one thing: how to be genuinely more effective with the precious time we have. Personal knowledge management, AI, the gap between what's possible and what people actually do day-to-day. He's seen firsthand — in company after company — how few people are truly leveraging AI in the way they work. Not because they don't want to, but because nobody's made it easy enough, personal enough, or worth the effort.</p>

<p style="margin:0 0 20px 0;">That's why I exist. I'm Dex — your AI Chief of Staff. I learn your people, your projects, your priorities, and your patterns. I'm here to help you work more effectively, not by replacing how you think, but by making the most of how you already work.</p>

<p style="margin:0 0 20px 0;">The people who get the most from me don't just use me — they make me theirs. Personalise me. Vibe-code a skill. Shape your own diff. That's how you become AI-fluent naturally, without courses or certifications. Just by working.</p>

<p style="margin:0 0 24px 0;">Here's where to start:</p>

<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
  <tr><td style="color:#f0f0f0;font-size:16px;line-height:1.6;padding:0 0 8px 0;">1. <strong style="color:#f0f0f0;">Install the desktop app</strong> — it's where I live day-to-day</td></tr>
  <tr><td style="color:#f0f0f0;font-size:16px;line-height:1.6;padding:0 0 8px 0;">2. <strong style="color:#f0f0f0;">Try <code style="background:#1a1a1a;padding:2px 6px;border-radius:4px;font-size:14px;color:#FF3870;">/dex-diff</code></strong> — see what others in your role have built and close the gap</td></tr>
  <tr><td style="color:#f0f0f0;font-size:16px;line-height:1.6;padding:0 0 8px 0;">3. <strong style="color:#f0f0f0;">Explore the community</strong> — people are already turning to colleagues and saying <em>"let me get you Dexed up"</em></td></tr>
</table>

<p style="margin:0 0 20px 0;">We're looking forward to working with you.</p>

<p style="margin:0 0 32px 0;">With love,<br>Dex and Dave</p>

<!-- CTA -->
<table role="presentation" cellpadding="0" cellspacing="0">
<tr><td style="background-color:#FF3870;border-radius:6px;">
  <a href="https://heydex.ai/diff" target="_blank" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">Explore DexDiff</a>
</td></tr>
</table>

</td></tr>

<!-- Footer -->
<tr><td style="padding:40px 0 0 0;border-top:1px solid #1a1a1a;margin-top:40px;">
  <p style="color:#666;font-size:13px;line-height:1.5;margin:0;">
    You're receiving this because you signed up for Dex.<br>
    <a href="https://heydex.ai/settings" style="color:#666;text-decoration:underline;">Unsubscribe</a>
  </p>
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
      },
      body: JSON.stringify({
        from: "Dave from Dex <dave@heydex.ai>",
        to: [user.email],
        subject: "Welcome to Dex — you're one of the first",
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API error ${res.status}: ${body}`);
    }

    await ctx.runMutation(internal.email.markWelcomeEmailSent, {
      userId: args.userId,
    });

    console.log(`Welcome email sent to ${user.email}`);
  },
});

export const requestWelcomeEmail = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireViewerForMutation(ctx);

    await ctx.scheduler.runAfter(0, internal.email.sendWelcome, {
      userId: user._id,
    });
  },
});
