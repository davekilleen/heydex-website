import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { sanitizeContent } from "./sanitization";
import { requireViewerForMutation } from "./viewer";

const REVIEW_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_LOVE_LETTER_DRAFT =
  "Dex helped me turn good intentions into actual systems. It gave structure to how I think, prepare, and follow through, and it made the value of my AI workflows clear enough to share with other people.";

function getEffectiveUserVisibility(user: {
  visibility?: "private" | "colleagues" | "public";
  isPublic?: boolean;
}) {
  return user.visibility ?? (user.isPublic ? "public" : "private");
}

function getSessionVisibility(session: {
  visibility?: "private" | "colleagues" | "public";
  makePublic?: boolean;
}) {
  return session.visibility ?? (session.makePublic ? "public" : "private");
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
  return user.photoUrl ?? user.image ?? "";
}

function buildSessionError(
  errorCode: "NOT_FOUND" | "ALREADY_PUBLISHED" | "EXPIRED" | "USER_NOT_FOUND",
  error: string,
  extra: Record<string, unknown> = {}
) {
  return {
    error,
    errorCode,
    ...extra,
  };
}

async function getReviewSessionByCode(ctx: any, sessionCode: string) {
  return await ctx.db
    .query("reviewSessions")
    .withIndex("by_sessionCode", (q: any) =>
      q.eq("sessionCode", sessionCode.toUpperCase())
    )
    .unique();
}

function assertSessionEditable(session: any) {
  if (!session) {
    throw new Error("Session not found");
  }

  if (session.published) {
    throw new Error("Already published");
  }

  if (Date.now() > session.expiresAt) {
    throw new Error("Session expired");
  }
}

// Generate a random 8-character session code
function generateSessionCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Create a review session (called by CLI after generating diffs)
export const createSession = mutation({
  args: {
    sessionToken: v.optional(v.string()),
    tokenIdentifier: v.optional(v.string()),
    diffs: v.array(v.object({
      diffId: v.string(),
      name: v.string(),
      description: v.string(),
      methodology: v.string(),
      tags: v.array(v.string()),
      roles: v.array(v.string()),
      integrations: v.array(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    let user = null;

    if (args.sessionToken) {
      user = await ctx.runMutation(internal.connect.resolveCliSession, {
        sessionToken: args.sessionToken,
      });
    } else if (args.tokenIdentifier) {
      user = await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", args.tokenIdentifier!)
        )
        .unique();
    }

    if (!user) {
      throw new Error("User not found");
    }

    const existingLoveLetter = await ctx.db
      .query("loveLetters")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    // Generate unique session code
    const sessionCode = generateSessionCode();

    // Create review session (expires in 30 minutes)
    const visibility = getEffectiveUserVisibility(user);
    await ctx.db.insert("reviewSessions", {
      sessionCode,
      userId: user._id,
      userHandle: user.handle,
      diffsData: args.diffs,
      visibility,
      loveLetterDraft: existingLoveLetter?.text,
      makePublic: visibility === "public",
      published: false,
      expiresAt: Date.now() + REVIEW_SESSION_TTL_MS,
      createdAt: Date.now(),
    });

    return { sessionCode };
  },
});

export const createLoveLetterSession = mutation({
  args: {
    initialText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireViewerForMutation(ctx);
    if (!user.handle) {
      throw new Error("Complete registration first");
    }

    const existingLoveLetter = await ctx.db
      .query("loveLetters")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();

    const sessionCode = generateSessionCode();
    const visibility = getEffectiveUserVisibility(user);
    await ctx.db.insert("reviewSessions", {
      sessionCode,
      userId: user._id,
      userHandle: user.handle,
      diffsData: [],
      visibility,
      loveLetterDraft:
        args.initialText ??
        existingLoveLetter?.text ??
        DEFAULT_LOVE_LETTER_DRAFT,
      makePublic: visibility === "public",
      published: false,
      expiresAt: Date.now() + REVIEW_SESSION_TTL_MS,
      createdAt: Date.now(),
    });

    return { sessionCode };
  },
});

// Get review session data (called by review page)
export const getSession = query({
  args: { sessionCode: v.string() },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);

    if (!session) {
      return buildSessionError("NOT_FOUND", "Review link not found");
    }

    if (session.published) {
      return buildSessionError("ALREADY_PUBLISHED", "This draft has already been published");
    }

    if (Date.now() > session.expiresAt) {
      return buildSessionError("EXPIRED", "This review link expired", {
        expiredAt: session.expiresAt,
      });
    }

    // Get user info
    const user = await ctx.db.get(session.userId);
    if (!user) {
      return buildSessionError(
        "USER_NOT_FOUND",
        "The profile for this review link could not be found"
      );
    }

    const canonicalDisplayName = getProfileDisplayName(user);
    const canonicalTitle = getProfileTitle(user);

    return {
      diffs: session.diffsData,
      userHandle: user.handle,
      userName: canonicalDisplayName,
      sessionKind:
        session.diffsData.length === 0
          ? "loveLetter"
          : session.loveLetterDraft
            ? "combined"
            : "diffs",
      profile: {
        displayName: canonicalDisplayName,
        title: canonicalTitle,
        company: user.company || "",
        summary: user.summary || "",
        photoUrl: getProfilePhotoUrl(user),
        linkedinUrl: user.linkedinUrl || "",
      },
      visibility: getSessionVisibility(session),
      loveLetterDraft: session.loveLetterDraft ?? "",
      makePublic: getSessionVisibility(session) === "public",
      needsRegistration: !user.handle, // True if user hasn't completed registration
      expiresAt: session.expiresAt,
    };
  },
});

export const updateVisibility = mutation({
  args: {
    sessionCode: v.string(),
    visibility: v.union(
      v.literal("private"),
      v.literal("colleagues"),
      v.literal("public")
    ),
  },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    await ctx.db.patch(session._id, {
      visibility: args.visibility,
      makePublic: args.visibility === "public",
    });
    return { success: true };
  },
});

// Backward-compatible boolean setter used by older clients.
export const updatePrivacy = mutation({
  args: {
    sessionCode: v.string(),
    makePublic: v.boolean(),
  },
  handler: async (ctx, args) => {
    const visibility = args.makePublic ? "public" : "private";
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    await ctx.db.patch(session._id, {
      visibility,
      makePublic: args.makePublic,
    });
    return { success: true };
  },
});

export const updateDraftDiff = mutation({
  args: {
    sessionCode: v.string(),
    index: v.number(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    methodology: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    if (args.index < 0 || args.index >= session.diffsData.length) {
      throw new Error("Draft not found");
    }

    const nextDiffs = [...session.diffsData];
    const current = nextDiffs[args.index];
    nextDiffs[args.index] = {
      ...current,
      name: args.name !== undefined ? args.name : current.name,
      description: args.description !== undefined ? args.description : current.description,
      methodology: args.methodology !== undefined ? args.methodology : current.methodology,
      tags: args.tags !== undefined ? args.tags : current.tags,
    };

    await ctx.db.patch(session._id, {
      diffsData: nextDiffs,
    });

    return { success: true, diff: nextDiffs[args.index] };
  },
});

export const updateProfileDraft = mutation({
  args: {
    sessionCode: v.string(),
    displayName: v.optional(v.string()),
    title: v.optional(v.string()),
    company: v.optional(v.string()),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    const updates: Record<string, string> = {};
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.title !== undefined) {
      updates.title = args.title;
      updates.role = args.title;
    }
    if (args.company !== undefined) updates.company = args.company;
    if (args.summary !== undefined) updates.summary = args.summary;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(session.userId, updates);
    }

    return { success: true };
  },
});

export const updateLoveLetterDraft = mutation({
  args: {
    sessionCode: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    await ctx.db.patch(session._id, {
      loveLetterDraft: args.text,
    });

    return { success: true };
  },
});

// Publish from review session
export const publishFromSession = mutation({
  args: { sessionCode: v.string() },
  handler: async (ctx, args) => {
    const session = await getReviewSessionByCode(ctx, args.sessionCode);
    assertSessionEditable(session);

    const user = await ctx.db.get(session.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.handle) {
      throw new Error("Complete registration first");
    }

    const visibility = getSessionVisibility(session);

    // Publish all diffs
    const publishedIds: string[] = [];
    for (const diff of session.diffsData) {
      // Sanitize content
      const sanitizedName = sanitizeContent(diff.name);
      const sanitizedDescription = sanitizeContent(diff.description);
      const sanitizedMethodology = sanitizeContent(diff.methodology);

      // Check if diff already exists
      const existing = await ctx.db
        .query("diffs")
        .withIndex("by_authorHandle_and_diffId", (q) =>
          q.eq("authorHandle", user.handle!).eq("diffId", diff.diffId)
        )
        .unique();

      if (existing) {
        // Update existing
        await ctx.db.patch(existing._id, {
          name: sanitizedName,
          description: sanitizedDescription,
          methodology: sanitizedMethodology,
          tags: diff.tags,
          roles: diff.roles,
          integrations: diff.integrations,
          status: "published" as const,
          publishedAt: Date.now(),
        });
        publishedIds.push(existing._id);
      } else {
        // Create new
        const id = await ctx.db.insert("diffs", {
          diffId: diff.diffId,
          authorId: user._id,
          authorHandle: user.handle!,
          name: sanitizedName,
          description: sanitizedDescription,
          methodology: sanitizedMethodology,
          tags: diff.tags,
          roles: diff.roles,
          integrations: diff.integrations,
          adoptionCount: 0,
          activeUserCount: 0,
          status: "published",
          publishedAt: Date.now(),
        });
        publishedIds.push(id);
      }
    }

    const sanitizedLoveLetter = session.loveLetterDraft?.trim()
      ? sanitizeContent(session.loveLetterDraft)
      : "";
    const canonicalDisplayName = getProfileDisplayName(user);
    const canonicalTitle = getProfileTitle(user);

    if (sanitizedLoveLetter) {
      const existingLoveLetter = await ctx.db
        .query("loveLetters")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .unique();

      const loveLetterPatch = {
        handle: user.handle,
        displayName: canonicalDisplayName,
        photoUrl: getProfilePhotoUrl(user) || undefined,
        role: canonicalTitle || undefined,
        function_: user.function_,
        seniority: user.seniority,
        company: user.company,
        text: sanitizedLoveLetter,
        status: "published" as const,
        hasDiffs: publishedIds.length > 0,
        diffSlugs:
          session.diffsData.length > 0
            ? session.diffsData.map((diff) => diff.diffId)
            : undefined,
      };

      if (existingLoveLetter) {
        await ctx.db.patch(existingLoveLetter._id, loveLetterPatch);
      } else {
        await ctx.db.insert("loveLetters", {
          userId: user._id,
          createdAt: Date.now(),
          ...loveLetterPatch,
        });
      }
    }

    await ctx.db.patch(user._id, {
      visibility,
      isPublic: visibility === "public",
    });

    // Mark session as published and sync the final handle in case the user
    // completed registration after the session was created.
    await ctx.db.patch(session._id, {
      published: true,
      userHandle: user.handle,
    });

    return {
      success: true,
      handle: user.handle,
      publishedCount: publishedIds.length,
    };
  },
});

// Check if session has been published (polled by CLI)
export const checkPublished = query({
  args: { sessionCode: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("reviewSessions")
      .withIndex("by_sessionCode", (q) =>
        q.eq("sessionCode", args.sessionCode.toUpperCase())
      )
      .unique();

    if (!session) {
      return { published: false, error: "Session not found" };
    }

    const user = await ctx.db.get(session.userId);

    return {
      published: session.published,
      handle: user?.handle ?? session.userHandle,
    };
  },
});
