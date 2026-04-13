import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

type AuthIdentity = NonNullable<
  Awaited<ReturnType<QueryCtx["auth"]["getUserIdentity"]>>
>;

type Viewer = {
  identity: AuthIdentity;
  user: Doc<"users">;
  userId: Id<"users">;
};

function pickNewestUser(users: Doc<"users">[]): Doc<"users"> | null {
  if (users.length === 0) {
    return null;
  }
  return [...users].sort((a, b) => b._creationTime - a._creationTime)[0];
}

async function findUserForIdentity(
  ctx: QueryCtx | MutationCtx,
  identity: AuthIdentity
): Promise<Doc<"users"> | null> {
  const byTokenIdentifier = identity.tokenIdentifier
    ? await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", identity.tokenIdentifier)
        )
        .unique()
    : null;

  if (byTokenIdentifier) {
    return byTokenIdentifier;
  }

  if (!identity.email) {
    return null;
  }

  const emailMatches = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", identity.email))
    .take(10);

  if (emailMatches.length === 1) {
    return emailMatches[0];
  }

  const completedMatches = emailMatches.filter(
    (user) => !!user.handle || user.onboardingCompleted === true
  );
  if (completedMatches.length === 1) {
    return completedMatches[0];
  }

  if (identity.name) {
    const exactNameMatch =
      completedMatches.find(
        (user) =>
          user.displayName === identity.name || user.name === identity.name
      ) ??
      emailMatches.find(
        (user) =>
          user.displayName === identity.name || user.name === identity.name
      );

    if (exactNameMatch) {
      return exactNameMatch;
    }
  }

  return pickNewestUser(completedMatches) ?? pickNewestUser(emailMatches);
}

async function loadViewer(
  ctx: QueryCtx | MutationCtx
): Promise<Viewer | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  const userId = await getAuthUserId(ctx);
  let user = userId ? await ctx.db.get(userId as Id<"users">) : null;

  if (!user) {
    user = await findUserForIdentity(ctx, identity);
    if (user) {
      console.warn(
        `[auth-recovery] Resolved viewer via fallback for ${identity.email ?? "unknown-email"}`
      );
    }
  }

  if (!user) {
    return null;
  }

  return {
    identity,
    user,
    userId: user._id,
  };
}

export async function getViewerOrNull(
  ctx: QueryCtx | MutationCtx
): Promise<Viewer | null> {
  return await loadViewer(ctx);
}

export async function requireViewer(
  ctx: QueryCtx | MutationCtx
): Promise<Viewer> {
  const viewer = await loadViewer(ctx);
  if (!viewer) {
    throw new Error("Not authenticated");
  }
  return viewer;
}

export async function requireViewerForMutation(
  ctx: MutationCtx
): Promise<Viewer> {
  const viewer = await requireViewer(ctx);

  const updates: Partial<Doc<"users">> = {};
  if (viewer.user.tokenIdentifier !== viewer.identity.tokenIdentifier) {
    updates.tokenIdentifier = viewer.identity.tokenIdentifier;
  }
  if (!viewer.user.email && viewer.identity.email) {
    updates.email = viewer.identity.email;
  }
  if (!viewer.user.name && viewer.identity.name) {
    updates.name = viewer.identity.name;
  }

  if (Object.keys(updates).length > 0) {
    await ctx.db.patch(viewer.userId, updates);
    return {
      ...viewer,
      user: {
        ...viewer.user,
        ...updates,
      },
    };
  }

  return viewer;
}
