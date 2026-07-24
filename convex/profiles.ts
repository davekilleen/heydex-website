import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { QueryCtx, internalQuery, query } from "./_generated/server";
import { getViewerOrNull } from "./viewer";
import { requireBetaUser, requireBetaViewer } from "./lib/beta";

const PROFILE_BUNDLE_CONTRACT_VERSION = "2026-04-10";

function getEffectiveVisibility(user: {
  visibility?: "private" | "colleagues" | "public";
  isPublic?: boolean;
}) {
  return user.visibility ?? (user.isPublic ? "public" : "private");
}

type ProfileViewer = {
  userId: Doc<"users">["_id"];
  user: {
    companyId?: Doc<"users">["companyId"];
    domain?: Doc<"users">["domain"];
  };
} | null | undefined;

export function viewerCanAccessProfile(
  viewer: ProfileViewer,
  targetUser: Doc<"users">
) {
  const visibility = getEffectiveVisibility(targetUser);
  const viewerIsOwner = viewer?.userId === targetUser._id;
  const viewerIsColleague =
    !!viewer &&
    (
      (viewer.user.companyId && targetUser.companyId && viewer.user.companyId === targetUser.companyId) ||
      (!!viewer.user.domain && !!targetUser.domain && viewer.user.domain === targetUser.domain)
    );

  return (
    visibility === "public" ||
    viewerIsOwner ||
    (visibility === "colleagues" && viewerIsColleague)
  );
}

function getProfileDisplayName(user: {
  displayName?: string;
  name?: string;
  handle?: string;
}) {
  return user.displayName ?? user.name ?? user.handle ?? "";
}

function getProfileTitle(user: {
  title?: string;
  role?: string;
}) {
  return user.title ?? user.role ?? "";
}

function getProfilePhotoUrl(user: {
  photoUrl?: string;
  image?: string;
}) {
  return user.photoUrl ?? user.image ?? undefined;
}

function sortPublishedDiffs(diffs: Doc<"diffs">[]) {
  return [...diffs]
    .filter((diff) => diff.status === "published")
    .sort((left, right) => {
      const leftOrder = left.publishedAt ?? left._creationTime;
      const rightOrder = right.publishedAt ?? right._creationTime;
      return leftOrder - rightOrder;
    });
}

async function getAccessibleProfileUserForViewer(
  ctx: QueryCtx,
  viewer: ProfileViewer,
  handle: string,
) {
  const user = await ctx.db
    .query("users")
    .withIndex("by_handle", (q) => q.eq("handle", handle))
    .unique();

  if (!user || !user.handle) {
    return null;
  }

  const visibility = getEffectiveVisibility(user);
  if (!viewerCanAccessProfile(viewer, user)) {
    return null;
  }

  return {
    user,
    visibility,
  };
}

async function getAccessibleProfileUser(ctx: QueryCtx, handle: string) {
  return await getAccessibleProfileUserForViewer(
    ctx,
    await getViewerOrNull(ctx),
    handle,
  );
}

async function getAccessibleProfileUserForBetaUser(
  ctx: QueryCtx,
  betaUserId: Doc<"users">["_id"],
  handle: string,
) {
  const betaUser = await requireBetaUser(ctx, betaUserId);
  return await getAccessibleProfileUserForViewer(
    ctx,
    { userId: betaUser._id, user: betaUser },
    handle,
  );
}

async function buildProfileBundle(
  ctx: QueryCtx,
  user: Doc<"users">,
  visibility: "private" | "colleagues" | "public"
) {
  const { publishedDiffs, publishedLoveLetter } = await getPublishedProfileContent(
    ctx,
    user._id,
    user.handle!,
  );
  const canonicalDisplayName = getProfileDisplayName(user);
  const canonicalTitle = getProfileTitle(user);

  return {
    contractVersion: PROFILE_BUNDLE_CONTRACT_VERSION,
    profile: {
      handle: user.handle,
      displayName: canonicalDisplayName,
      role: canonicalTitle,
      title: canonicalTitle,
      company: user.company,
      function_: user.function_,
      seniority: user.seniority,
      summary: user.summary,
      photoUrl: getProfilePhotoUrl(user),
      linkedinUrl: user.linkedinUrl,
      visibility,
      totalAdoptions: publishedDiffs.reduce((sum, diff) => sum + diff.adoptionCount, 0),
    },
    workflows: publishedDiffs.map((diff) => ({
      diffId: diff.diffId,
      name: diff.name,
      description: diff.description,
      methodology: diff.methodology,
      tags: diff.tags,
      roles: diff.roles,
      integrations: diff.integrations,
      adoptionCount: diff.adoptionCount,
      publishedAt: diff.publishedAt,
    })),
    loveLetter: publishedLoveLetter
      ? {
          text: publishedLoveLetter.text,
          createdAt: publishedLoveLetter.createdAt,
        }
      : null,
  };
}

async function getPublishedProfileContent(ctx: QueryCtx, userId: Doc<"users">["_id"], handle: string) {
  const diffs = await ctx.db
    .query("diffs")
    .withIndex("by_authorId", (q) => q.eq("authorId", userId))
    .take(100);

  const publishedDiffs = sortPublishedDiffs(diffs);

  const publishedLoveLetter =
    (
      await ctx.db
        .query("loveLetters")
        .withIndex("by_status_and_createdAt", (q) => q.eq("status", "published"))
        .order("desc")
        .take(200)
    ).find((letter) => letter.handle === handle) ?? null;

  return {
    publishedDiffs,
    publishedLoveLetter,
  };
}

// Get a user's public profile with their published diffs
export const get = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    await requireBetaViewer(ctx);
    const accessible = await getAccessibleProfileUser(ctx, args.handle);
    if (!accessible) {
      return null;
    }

    const { user, visibility } = accessible;
    const { publishedDiffs } = await getPublishedProfileContent(ctx, user._id, user.handle!);
    const canonicalDisplayName = getProfileDisplayName(user);
    const canonicalTitle = getProfileTitle(user);

    return {
      handle: user.handle,
      displayName: canonicalDisplayName,
      role: canonicalTitle,
      title: canonicalTitle,
      company: user.company,
      function_: user.function_,
      seniority: user.seniority,
      summary: user.summary,
      photoUrl: getProfilePhotoUrl(user),
      linkedinUrl: user.linkedinUrl,
      visibility,
      diffs: publishedDiffs.map((diff) => ({
        diffId: diff.diffId,
        name: diff.name,
        description: diff.description,
        tags: diff.tags,
        roles: diff.roles,
        adoptionCount: diff.adoptionCount,
      })),
      totalAdoptions: publishedDiffs.reduce((sum, diff) => sum + diff.adoptionCount, 0),
    };
  },
});

export const getBundle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    await requireBetaViewer(ctx);
    const accessible = await getAccessibleProfileUser(ctx, args.handle);
    if (!accessible) {
      return null;
    }

    const { user, visibility } = accessible;
    return await buildProfileBundle(ctx, user, visibility);
  },
});

export const getForBetaUser = internalQuery({
  args: {
    betaUserId: v.id("users"),
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const accessible = await getAccessibleProfileUserForBetaUser(
      ctx,
      args.betaUserId,
      args.handle,
    );
    if (!accessible) return null;

    const { user, visibility } = accessible;
    const { publishedDiffs } = await getPublishedProfileContent(
      ctx,
      user._id,
      user.handle!,
    );
    const canonicalDisplayName = getProfileDisplayName(user);
    const canonicalTitle = getProfileTitle(user);
    return {
      handle: user.handle,
      displayName: canonicalDisplayName,
      role: canonicalTitle,
      title: canonicalTitle,
      company: user.company,
      function_: user.function_,
      seniority: user.seniority,
      summary: user.summary,
      photoUrl: getProfilePhotoUrl(user),
      linkedinUrl: user.linkedinUrl,
      visibility,
      diffs: publishedDiffs.map((diff) => ({
        diffId: diff.diffId,
        name: diff.name,
        description: diff.description,
        tags: diff.tags,
        roles: diff.roles,
        adoptionCount: diff.adoptionCount,
      })),
      totalAdoptions: publishedDiffs.reduce(
        (sum, diff) => sum + diff.adoptionCount,
        0,
      ),
    };
  },
});

export const getBundleForBetaUser = internalQuery({
  args: {
    betaUserId: v.id("users"),
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const accessible = await getAccessibleProfileUserForBetaUser(
      ctx,
      args.betaUserId,
      args.handle,
    );
    if (!accessible) return null;
    return await buildProfileBundle(
      ctx,
      accessible.user,
      accessible.visibility,
    );
  },
});
