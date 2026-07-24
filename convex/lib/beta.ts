import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { getViewerOrNull, requireViewer } from "../viewer";

export const BETA_DENIED_MESSAGE =
  "You're not in the DexDiff beta yet. Join the waitlist and we'll let you know when a place opens.";

let betaGateDisableWarningLogged = false;

export function normalizeBetaEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isBetaGateDisabled(): boolean {
  const disabled = process.env.BETA_GATE?.trim().toLowerCase() === "off";
  if (disabled && !betaGateDisableWarningLogged) {
    console.warn(
      "[SECURITY AUDIT] BETA_GATE=off: DexDiff private-beta authorization is DISABLED",
    );
    betaGateDisableWarningLogged = true;
  }
  return disabled;
}

async function isEmailAllowlisted(
  ctx: QueryCtx | MutationCtx,
  email: string | undefined,
): Promise<boolean> {
  if (!email) {
    return false;
  }

  const normalized = normalizeBetaEmail(email);
  const entry = await ctx.db
    .query("betaAllowlist")
    .withIndex("by_email", (q) => q.eq("email", normalized))
    .unique();
  return entry !== null;
}

export async function getBetaViewerAccess(
  ctx: QueryCtx | MutationCtx,
): Promise<{
  authenticated: boolean;
  allowed: boolean;
  userId: Id<"users"> | null;
}> {
  const viewer = await getViewerOrNull(ctx);
  if (!viewer) {
    return { authenticated: false, allowed: false, userId: null };
  }

  if (isBetaGateDisabled()) {
    return { authenticated: true, allowed: true, userId: viewer.userId };
  }

  const email = viewer.identity.email ?? viewer.user.email;
  return {
    authenticated: true,
    allowed: await isEmailAllowlisted(ctx, email),
    userId: viewer.userId,
  };
}

export async function requireBetaViewer(
  ctx: QueryCtx | MutationCtx,
) {
  if (isBetaGateDisabled()) {
    return await getViewerOrNull(ctx);
  }

  const viewer = await requireViewer(ctx);
  const email = viewer.identity.email ?? viewer.user.email;
  if (!(await isEmailAllowlisted(ctx, email))) {
    throw new Error(BETA_DENIED_MESSAGE);
  }
  return viewer;
}

export async function requireBetaUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }
  if (isBetaGateDisabled()) {
    return user;
  }
  if (!(await isEmailAllowlisted(ctx, user.email))) {
    throw new Error(BETA_DENIED_MESSAGE);
  }
  return user;
}
