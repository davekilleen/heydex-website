import { v } from "convex/values";
import { internalMutation, MutationCtx } from "./_generated/server";

const REVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const CLI_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const visibilityValidator = v.union(
  v.literal("private"),
  v.literal("colleagues"),
  v.literal("public")
);

const reviewDiffValidator = v.object({
  diffId: v.string(),
  name: v.string(),
  description: v.string(),
  methodology: v.string(),
  tags: v.array(v.string()),
  roles: v.array(v.string()),
  integrations: v.array(v.string()),
});

type ReviewDiff = {
  diffId: string;
  name: string;
  description: string;
  methodology: string;
  tags: string[];
  roles: string[];
  integrations: string[];
};

const DEFAULT_DIFFS: ReviewDiff[] = [
  {
    diffId: "exec-meeting-prep",
    name: "Executive Meeting Prep",
    description:
      "Pull relationship context, open threads, and recent notes into a single prep layer before important meetings.",
    methodology:
      "Problem:\nMeeting context lives in too many places.\n\nSolution:\nDex assembles the relevant people, notes, and open loops before the meeting starts.",
    tags: ["meeting prep", "exec", "relationships"],
    roles: ["Executive", "Founder", "Product"],
    integrations: ["calendar", "meeting-notes", "gmail"],
  },
  {
    diffId: "post-meeting-follow-through",
    name: "Post-Meeting Follow Through",
    description:
      "Turn meeting outcomes into visible commitments, next steps, and prompts so the important things do not drift.",
    methodology:
      "Problem:\nImportant follow-up gets lost after meetings.\n\nSolution:\nDex turns decisions into visible actions and brings them back at the right time.",
    tags: ["follow through", "accountability", "meetings"],
    roles: ["Executive", "Customer Success", "Sales"],
    integrations: ["tasks", "meeting-notes", "calendar"],
  },
];

function generateSessionCode(length: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function buildDefaultProfile(handle: string) {
  return {
    email: `${handle}@example.com`,
    name: "DexDiff E2E",
    displayName: "DexDiff E2E",
    title: "VP Product",
    role: "VP Product",
    company: "Heydex",
    summary:
      "An automated test profile used to validate the DexDiff review and publish flow.",
    linkedinUrl: "https://linkedin.com/in/dexdiff-e2e",
    photoUrl: "https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=200&q=80",
    onboardingCompleted: true,
    tokenIdentifier: `e2e:${handle}`,
  };
}

async function upsertHarnessUser(
  ctx: MutationCtx,
  args: {
    handle: string;
    displayName?: string;
    title?: string;
    company?: string;
    summary?: string;
    linkedinUrl?: string;
    photoUrl?: string;
    visibility: "private" | "colleagues" | "public";
  }
) {
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_handle", (q) => q.eq("handle", args.handle))
    .unique();

  const defaults = buildDefaultProfile(args.handle);
  const title = args.title ?? defaults.title;
  const userPatch = {
    email: defaults.email,
    name: args.displayName ?? defaults.displayName,
    displayName: args.displayName ?? defaults.displayName,
    handle: args.handle,
    title,
    role: title,
    company: args.company ?? defaults.company,
    summary: args.summary ?? defaults.summary,
    linkedinUrl: args.linkedinUrl ?? defaults.linkedinUrl,
    photoUrl: args.photoUrl ?? defaults.photoUrl,
    onboardingCompleted: true,
    visibility: args.visibility,
    isPublic: args.visibility === "public",
    tokenIdentifier: defaults.tokenIdentifier,
  };

  if (existingUser) {
    await ctx.db.patch(existingUser._id, userPatch);
    return {
      _id: existingUser._id,
      handle: args.handle,
    };
  }

  const userId = await ctx.db.insert("users", userPatch);
  return {
    _id: userId,
    handle: args.handle,
  };
}

export const createCliSession = internalMutation({
  args: {
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    visibility: v.optional(visibilityValidator),
    expired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? "dexdiff-e2e";
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      displayName: args.displayName,
      title: args.title,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      visibility,
    });

    const sessionToken = crypto.randomUUID().replace(/-/g, "");
    await ctx.db.insert("cliSessions", {
      sessionToken,
      userId: user._id,
      createdAt: Date.now(),
      expiresAt: args.expired ? Date.now() - 1000 : Date.now() + CLI_SESSION_TTL_MS,
      lastUsedAt: Date.now(),
    });

    return {
      handle,
      sessionToken,
    };
  },
});

export const createConnectionCode = internalMutation({
  args: {
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    visibility: v.optional(visibilityValidator),
    expired: v.optional(v.boolean()),
    redeemed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? `dexdiff-code-${Date.now()}`;
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      displayName: args.displayName,
      title: args.title,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      visibility,
    });

    const code = generateSessionCode(6);
    await ctx.db.insert("connectionCodes", {
      code,
      userId: user._id,
      userHandle: handle,
      expiresAt: args.expired ? Date.now() - 1000 : Date.now() + REVIEW_SESSION_TTL_MS,
      redeemed: args.redeemed === true,
    });

    return {
      handle,
      code,
    };
  },
});

export const createReviewSession = internalMutation({
  args: {
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    visibility: v.optional(visibilityValidator),
    diffs: v.optional(v.array(reviewDiffValidator)),
    expired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? "dexdiff-e2e";
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      displayName: args.displayName,
      title: args.title,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      visibility,
    });

    const sessionCode = generateSessionCode(8);
    const now = Date.now();
    await ctx.db.insert("reviewSessions", {
      sessionCode,
      userId: user._id,
      userHandle: handle,
      diffsData: args.diffs && args.diffs.length > 0 ? args.diffs : DEFAULT_DIFFS,
      visibility,
      makePublic: visibility === "public",
      published: false,
      expiresAt: args.expired ? now - 1000 : now + REVIEW_SESSION_TTL_MS,
      createdAt: now,
    });

    return {
      handle,
      sessionCode,
    };
  },
});

export const createPublicProfileBundle = internalMutation({
  args: {
    handle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    visibility: v.optional(visibilityValidator),
    loveLetter: v.optional(v.string()),
    diffs: v.optional(v.array(reviewDiffValidator)),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? `dexdiff-public-${Date.now()}`;
    const visibility = args.visibility ?? "public";
    const user = await upsertHarnessUser(ctx, {
      handle,
      displayName: args.displayName,
      title: args.title,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      visibility,
    });

    const diffs = args.diffs && args.diffs.length > 0 ? args.diffs : DEFAULT_DIFFS;

    for (const [index, diff] of diffs.entries()) {
      const existing = await ctx.db
        .query("diffs")
        .withIndex("by_authorHandle_and_diffId", (q) =>
          q.eq("authorHandle", handle).eq("diffId", diff.diffId)
        )
        .unique();

      const publishedAt = Date.now() + index;

      if (existing) {
        await ctx.db.patch(existing._id, {
          name: diff.name,
          description: diff.description,
          methodology: diff.methodology,
          tags: diff.tags,
          roles: diff.roles,
          integrations: diff.integrations,
          status: "published",
          publishedAt,
          adoptionCount: existing.adoptionCount,
          activeUserCount: existing.activeUserCount,
        });
        continue;
      }

      await ctx.db.insert("diffs", {
        diffId: diff.diffId,
        authorId: user._id,
        authorHandle: handle,
        name: diff.name,
        description: diff.description,
        methodology: diff.methodology,
        tags: diff.tags,
        roles: diff.roles,
        integrations: diff.integrations,
        adoptionCount: 0,
        activeUserCount: 0,
        status: "published",
        publishedAt,
      });
    }

    if (typeof args.loveLetter === "string" && args.loveLetter.trim().length > 0) {
      const existingLetter = await ctx.db
        .query("loveLetters")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique();

      const letterPatch = {
        handle,
        displayName: args.displayName ?? buildDefaultProfile(handle).displayName,
        photoUrl: args.photoUrl ?? buildDefaultProfile(handle).photoUrl,
        role: args.title ?? buildDefaultProfile(handle).title,
        function_: "Product",
        seniority: "VP",
        company: args.company ?? buildDefaultProfile(handle).company,
        text: args.loveLetter.trim(),
        status: "published" as const,
        createdAt: Date.now(),
        hasDiffs: diffs.length > 0,
        diffSlugs: diffs.map((diff) => diff.diffId),
      };

      if (existingLetter) {
        await ctx.db.patch(existingLetter._id, letterPatch);
      } else {
        await ctx.db.insert("loveLetters", {
          userId: user._id,
          ...letterPatch,
        });
      }
    }

    return {
      handle,
      profileUrl: `/diff/@${handle}/`,
      diffIds: diffs.map((diff) => diff.diffId),
    };
  },
});
