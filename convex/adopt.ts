import { ConvexError, v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireViewerForMutation } from "./viewer";
import { viewerCanAccessProfile } from "./profiles";

const ADOPT_GRANT_TTL_MS = 10 * 60 * 1000;
const GRANT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase().replace(/^@/, "");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function generateGrantCode(): string {
  let code = "";
  for (let index = 0; index < 16; index += 1) {
    code += GRANT_CODE_ALPHABET[Math.floor(Math.random() * GRANT_CODE_ALPHABET.length)];
  }
  return code;
}

function warnInvalidGrant(reason: string) {
  console.warn("[adopt] invalid_grant", { reason });
}

export const generateGrant = mutation({
  args: {
    targetHandle: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewerForMutation(ctx);
    const targetHandle = normalizeHandle(args.targetHandle);
    const targetUser = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", targetHandle))
      .unique();

    if (!targetUser || !targetUser.handle) {
      throw new ConvexError({ code: "TARGET_NOT_FOUND" });
    }

    if (!viewerCanAccessProfile(viewer, targetUser)) {
      throw new ConvexError({ code: "NOT_AUTHORIZED" });
    }

    const code = generateGrantCode();
    await ctx.db.insert("adoptGrants", {
      code,
      targetHandle,
      granterUserId: viewer.userId,
      expiresAt: Date.now() + ADOPT_GRANT_TTL_MS,
      redeemed: false,
    });

    await ctx.scheduler.runAfter(ADOPT_GRANT_TTL_MS, internal.adopt.expireGrant, { code });

    return {
      code,
      expiresInSeconds: ADOPT_GRANT_TTL_MS / 1000,
    };
  },
});

export const redeemGrant = internalMutation({
  args: {
    code: v.string(),
    handle: v.string(),
  },
  handler: async (ctx, args) => {
    const code = normalizeCode(args.code);
    const handle = normalizeHandle(args.handle);
    const grant = await ctx.db
      .query("adoptGrants")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();

    if (!grant) {
      warnInvalidGrant("missing");
      return { ok: false } as const;
    }

    if (grant.redeemed) {
      warnInvalidGrant("redeemed");
      return { ok: false } as const;
    }

    if (Date.now() > grant.expiresAt) {
      warnInvalidGrant("expired");
      return { ok: false } as const;
    }

    if (grant.targetHandle !== handle) {
      warnInvalidGrant("handle_mismatch");
      return { ok: false } as const;
    }

    await ctx.db.patch(grant._id, { redeemed: true });

    const bundle = await ctx.runQuery(internal.profiles.getBundleUnchecked, {
      handle: grant.targetHandle,
    });
    if (!bundle) {
      warnInvalidGrant("bundle_missing");
      return { ok: false } as const;
    }

    return {
      ok: true,
      bundle,
    } as const;
  },
});

export const expireGrant = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const grant = await ctx.db
      .query("adoptGrants")
      .withIndex("by_code", (q) => q.eq("code", normalizeCode(args.code)))
      .unique();

    if (grant) {
      await ctx.db.delete(grant._id);
    }
  },
});
