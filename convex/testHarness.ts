import { v } from "convex/values";
import { internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  getDomainForEmail,
  isWorkDomain,
  normalizeDomain,
} from "./users";
import { getCompanyViewForUser } from "./companies";

const REVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const CLI_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADOPT_GRANT_TTL_MS = 10 * 60 * 1000;

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

const companyDiffValidator = v.object({
  diffId: v.string(),
  name: v.string(),
  description: v.string(),
  methodology: v.string(),
  tags: v.array(v.string()),
  roles: v.array(v.string()),
  integrations: v.array(v.string()),
  adoptionCount: v.optional(v.number()),
});

const companyMemberValidator = v.object({
  handle: v.string(),
  email: v.optional(v.string()),
  displayName: v.optional(v.string()),
  title: v.optional(v.string()),
  company: v.optional(v.string()),
  function_: v.optional(v.string()),
  summary: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  photoUrl: v.optional(v.string()),
  integrations: v.optional(v.array(v.string())),
  visibility: visibilityValidator,
  diffs: v.optional(v.array(companyDiffValidator)),
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

type HarnessUserArgs = {
  handle: string;
  email?: string;
  domain?: string;
  displayName?: string;
  title?: string;
  company?: string;
  function_?: string;
  summary?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  integrations?: string[];
  visibility: "private" | "colleagues" | "public";
};

type HarnessDiff = ReviewDiff & {
  adoptionCount?: number;
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

async function decrementCompanyMemberCount(
  ctx: MutationCtx,
  companyId: Id<"companies"> | undefined
) {
  if (!companyId) return;

  const company = await ctx.db.get(companyId);
  if (!company) return;

  if (company.memberCount <= 1) {
    await ctx.db.delete(company._id);
    return;
  }

  await ctx.db.patch(company._id, {
    memberCount: company.memberCount - 1,
  });
}

async function resolveHarnessCompany(
  ctx: MutationCtx,
  args: {
    domain: string;
    displayName?: string;
    existingCompanyId?: Id<"companies">;
  }
) {
  if (!isWorkDomain(args.domain)) {
    await decrementCompanyMemberCount(ctx, args.existingCompanyId);
    return undefined;
  }

  const existingCompany = await ctx.db
    .query("companies")
    .withIndex("by_domain", (q) => q.eq("domain", args.domain))
    .unique();

  if (existingCompany) {
    if (existingCompany._id !== args.existingCompanyId) {
      await decrementCompanyMemberCount(ctx, args.existingCompanyId);
      await ctx.db.patch(existingCompany._id, {
        displayName: args.displayName ?? existingCompany.displayName,
        memberCount: existingCompany.memberCount + 1,
      });
    } else if (
      args.displayName !== undefined &&
      args.displayName !== existingCompany.displayName
    ) {
      await ctx.db.patch(existingCompany._id, {
        displayName: args.displayName,
      });
    }
    return existingCompany._id;
  }

  await decrementCompanyMemberCount(ctx, args.existingCompanyId);
  return await ctx.db.insert("companies", {
    domain: args.domain,
    displayName: args.displayName,
    memberCount: 1,
  });
}

async function upsertHarnessUser(
  ctx: MutationCtx,
  args: HarnessUserArgs
) {
  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_handle", (q) => q.eq("handle", args.handle))
    .unique();

  const defaults = buildDefaultProfile(args.handle);
  const title = args.title ?? defaults.title;
  const email = args.email ?? (
    args.domain
      ? `${args.handle}@${normalizeDomain(args.domain)}`
      : defaults.email
  );
  const domain = args.domain
    ? normalizeDomain(args.domain)
    : getDomainForEmail(email);
  const companyId = await resolveHarnessCompany(ctx, {
    domain,
    displayName: args.company ?? defaults.company,
    existingCompanyId: existingUser?.companyId,
  });
  const userPatch = {
    email,
    name: args.displayName ?? defaults.displayName,
    displayName: args.displayName ?? defaults.displayName,
    handle: args.handle,
    domain,
    title,
    role: title,
    company: args.company ?? defaults.company,
    companyId,
    function_: args.function_,
    summary: args.summary ?? defaults.summary,
    linkedinUrl: args.linkedinUrl ?? defaults.linkedinUrl,
    photoUrl: args.photoUrl ?? defaults.photoUrl,
    integrations: args.integrations,
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
    email,
    domain,
  };
}

async function upsertPublishedDiffs(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    handle: string;
    diffs: HarnessDiff[];
  }
) {
  for (const [index, diff] of args.diffs.entries()) {
    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorId_and_diffId", (q) =>
        q.eq("authorId", args.userId).eq("diffId", diff.diffId)
      )
      .unique();

    const now = Date.now() + index;
    const patch = {
      authorHandle: args.handle,
      name: diff.name,
      description: diff.description,
      methodology: diff.methodology,
      tags: diff.tags,
      roles: diff.roles,
      integrations: diff.integrations,
      adoptionCount: diff.adoptionCount ?? existing?.adoptionCount ?? 0,
      activeUserCount: existing?.activeUserCount ?? 0,
      status: "published" as const,
      publishedAt: existing?.publishedAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      continue;
    }

    await ctx.db.insert("diffs", {
      diffId: diff.diffId,
      authorId: args.userId,
      ...patch,
    });
  }
}

export const createCliSession = internalMutation({
  args: {
    handle: v.optional(v.string()),
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
    expired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? "dexdiff-e2e";
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      email: args.email,
      domain: args.domain,
      displayName: args.displayName,
      title: args.title,
      function_: args.function_,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      integrations: args.integrations,
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
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
    expired: v.optional(v.boolean()),
    redeemed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? `dexdiff-code-${Date.now()}`;
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      email: args.email,
      domain: args.domain,
      displayName: args.displayName,
      title: args.title,
      function_: args.function_,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      integrations: args.integrations,
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
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
    diffs: v.optional(v.array(reviewDiffValidator)),
    expired: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? "dexdiff-e2e";
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      email: args.email,
      domain: args.domain,
      displayName: args.displayName,
      title: args.title,
      function_: args.function_,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      integrations: args.integrations,
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
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
    loveLetter: v.optional(v.string()),
    diffs: v.optional(v.array(reviewDiffValidator)),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? `dexdiff-public-${Date.now()}`;
    const visibility = args.visibility ?? "public";
    const user = await upsertHarnessUser(ctx, {
      handle,
      email: args.email,
      domain: args.domain,
      displayName: args.displayName,
      title: args.title,
      function_: args.function_,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      integrations: args.integrations,
      visibility,
    });

    const diffs = args.diffs && args.diffs.length > 0 ? args.diffs : DEFAULT_DIFFS;
    await upsertPublishedDiffs(ctx, {
      userId: user._id,
      handle,
      diffs,
    });

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
      profileUrl: `/diff/${handle}/`,
      diffIds: diffs.map((diff) => diff.diffId),
    };
  },
});

export const createAdoptionForEmail = internalMutation({
  args: {
    email: v.string(),
    authorHandle: v.string(),
    diffSlug: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();

    if (!user) {
      throw new Error(`User not found for email: ${args.email}`);
    }

    const diff = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.authorHandle).eq("diffId", args.diffSlug)
      )
      .unique();

    if (!diff) {
      throw new Error(
        `Diff not found for ${args.authorHandle}/${args.diffSlug}`
      );
    }

    const existing = await ctx.db
      .query("adoptions")
      .withIndex("by_userId_and_diffId", (q) =>
        q.eq("userId", user._id).eq("diffId", diff._id)
      )
      .unique();

    if (existing && !existing.removed) {
      await ctx.db.patch(existing._id, {
        lastActiveAt: Date.now(),
      });

      return {
        adoptionId: existing._id,
        userId: user._id,
        diffId: diff._id,
      };
    }

    if (existing && existing.removed) {
      await ctx.db.patch(existing._id, {
        removed: false,
        adoptedAt: Date.now(),
        lastActiveAt: Date.now(),
      });
      await ctx.db.patch(diff._id, {
        adoptionCount: diff.adoptionCount + 1,
        activeUserCount: diff.activeUserCount + 1,
      });

      return {
        adoptionId: existing._id,
        userId: user._id,
        diffId: diff._id,
      };
    }

    const adoptionId = await ctx.db.insert("adoptions", {
      userId: user._id,
      diffId: diff._id,
      authorHandle: args.authorHandle,
      diffSlug: args.diffSlug,
      adoptedAt: Date.now(),
      lastActiveAt: Date.now(),
      removed: false,
    });

    await ctx.db.patch(diff._id, {
      adoptionCount: diff.adoptionCount + 1,
      activeUserCount: diff.activeUserCount + 1,
    });

    return {
      adoptionId,
      userId: user._id,
      diffId: diff._id,
    };
  },
});

export const createAdoptGrant = internalMutation({
  args: {
    targetHandle: v.string(),
    granterHandle: v.optional(v.string()),
    expired: v.optional(v.boolean()),
    redeemed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.targetHandle))
      .unique();
    if (!target) {
      throw new Error(`Target not found for handle: ${args.targetHandle}`);
    }

    const granterHandle = args.granterHandle ?? `adopt-granter-${Date.now()}`;
    const granter = await upsertHarnessUser(ctx, {
      handle: granterHandle,
      visibility: "private",
    });
    const code = generateSessionCode(16);
    const now = Date.now();

    await ctx.db.insert("adoptGrants", {
      code,
      targetHandle: args.targetHandle,
      granterUserId: granter._id,
      expiresAt: args.expired ? now - 1000 : now + ADOPT_GRANT_TTL_MS,
      redeemed: args.redeemed === true,
    });

    return {
      code,
      targetHandle: args.targetHandle,
      granterHandle,
    };
  },
});

export const createAuthUser = internalMutation({
  args: {
    handle: v.optional(v.string()),
    email: v.optional(v.string()),
    domain: v.optional(v.string()),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    visibility: v.optional(visibilityValidator),
  },
  handler: async (ctx, args) => {
    const handle = args.handle ?? `auth-${Date.now()}`;
    const visibility = args.visibility ?? "private";
    const user = await upsertHarnessUser(ctx, {
      handle,
      email: args.email,
      domain: args.domain,
      displayName: args.displayName,
      title: args.title,
      function_: args.function_,
      company: args.company,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: args.photoUrl,
      integrations: args.integrations,
      visibility,
    });

    return {
      userId: user._id,
      handle,
      email: user.email,
      domain: user.domain,
    };
  },
});

export const createCompanyDomain = internalMutation({
  args: {
    domain: v.string(),
    company: v.optional(v.string()),
    members: v.array(companyMemberValidator),
  },
  handler: async (ctx, args) => {
    const domain = normalizeDomain(args.domain);
    const members = [];

    for (const member of args.members) {
      const user = await upsertHarnessUser(ctx, {
        handle: member.handle,
        email: member.email ?? `${member.handle}@${domain}`,
        domain,
        displayName: member.displayName,
        title: member.title,
        function_: member.function_,
        company: member.company ?? args.company,
        summary: member.summary,
        linkedinUrl: member.linkedinUrl,
        photoUrl: member.photoUrl,
        integrations: member.integrations,
        visibility: member.visibility,
      });

      if (member.diffs && member.diffs.length > 0) {
        await upsertPublishedDiffs(ctx, {
          userId: user._id,
          handle: member.handle,
          diffs: member.diffs,
        });
      }

      members.push({
        handle: member.handle,
        userId: user._id,
      });
    }

    return {
      domain,
      members,
    };
  },
});

export const getCompanyForHandle = internalQuery({
  args: {
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) return null;
    return await getCompanyViewForUser(ctx, user);
  },
});

export const getPublishedDiffsForHandle = internalQuery({
  args: {
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) return [];

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", user._id))
      .collect();

    return diffs
      .filter((diff) => diff.status === "published")
      .sort((left, right) => (left.publishedAt ?? 0) - (right.publishedAt ?? 0))
      .map((diff) => ({
        diffId: diff.diffId,
        name: diff.name,
        description: diff.description,
        methodology: diff.methodology,
        tags: diff.tags,
        roles: diff.roles,
        integrations: diff.integrations,
        adoptionCount: diff.adoptionCount,
        activeUserCount: diff.activeUserCount,
        publishedAt: diff.publishedAt,
        updatedAt: diff.updatedAt,
      }));
  },
});
