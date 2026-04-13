import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getViewerOrNull, requireViewerForMutation } from "./viewer";

// Blocklist of generic email providers that don't indicate a company
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com",
  "live.com", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "mac.com", "aol.com", "protonmail.com", "proton.me",
  "mail.com", "zoho.com", "yandex.com", "gmx.com", "gmx.net",
  "tutanota.com", "fastmail.com", "hey.com",
]);

// Subsidiary domains that should resolve to the same company.
// Maps variant domains to their canonical domain.
// Add entries as companies with multiple domains are discovered.
const DOMAIN_ALIASES: Record<string, string> = {
  "pendo.com": "pendo.io",
  "pendo.co.uk": "pendo.io",
  // Add more as needed: "acme.co.uk": "acme.com",
};

function extractDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

// Normalize domain to canonical form (handles subsidiary domains)
function normalizeDomain(domain: string): string {
  return DOMAIN_ALIASES[domain] ?? domain;
}

function isWorkDomain(domain: string): boolean {
  return domain.length > 0 && !GENERIC_DOMAINS.has(domain);
}

function getCanonicalTitle(input: {
  title?: string;
  role?: string;
}): string | undefined {
  if (input.title !== undefined) return input.title;
  if (input.role !== undefined) return input.role;
  return undefined;
}

// Register or complete profile for a user (called after auth).
// @convex-dev/auth creates the user record during OAuth. This mutation
// patches that record with profile fields (handle, role, company, etc.).
// If called again for a returning user, it's a no-op that returns their ID.
export const register = mutation({
  args: {
    displayName: v.string(),
    handle: v.string(),
    role: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    title: v.optional(v.string()),
    industry: v.optional(v.string()),
    seniority: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
    source: v.optional(v.string()),
    marketingOptOut: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, identity } = await requireViewerForMutation(ctx);

    // User exists — if they already have a handle, they're fully registered.
    if (user.handle) {
      return user._id;
    }

    // User exists from auth but hasn't completed profile — patch with profile fields.
    const handleTaken = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (handleTaken && handleTaken._id !== user._id) {
      throw new Error("Handle already taken");
    }

    const email = user.email ?? identity.email ?? "";
    const rawDomain = extractDomain(email);
    const domain = normalizeDomain(rawDomain);
    const canonicalTitle = getCanonicalTitle(args);
    const canonicalPhotoUrl = args.photoUrl ?? user.image;

    let companyId = user.companyId;
    if (!companyId && isWorkDomain(domain)) {
      const existingCompany = await ctx.db
        .query("companies")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .unique();

      if (existingCompany) {
        companyId = existingCompany._id;
        await ctx.db.patch(existingCompany._id, {
          memberCount: existingCompany.memberCount + 1,
        });
      } else {
        companyId = await ctx.db.insert("companies", {
          domain,
          displayName: args.company ?? undefined,
          memberCount: 1,
        });
      }
    }

    await ctx.db.patch(user._id, {
      email: user.email ?? identity.email,
      name: user.name ?? identity.name ?? args.displayName,
      domain,
      displayName: args.displayName,
      handle: args.handle,
      role: canonicalTitle,
      function_: args.function_,
      company: args.company,
      companyId,
      title: canonicalTitle,
      industry: args.industry,
      seniority: args.seniority,
      summary: args.summary,
      linkedinUrl: args.linkedinUrl,
      photoUrl: canonicalPhotoUrl,
      integrations: args.integrations,
      source: args.source,
      onboardingCompleted: true,
      marketingOptOut: args.marketingOptOut ?? false,
      isPublic: false, // Private by default - user must explicitly make public
      visibility: "private",
      tokenIdentifier: identity.tokenIdentifier,
    });

    return user._id;
  },
});

// Internal: look up a user by handle (for server-side use in HTTP actions)
export const getByHandle = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
  },
});

// Check if a handle is available (public — no auth needed)
export const checkHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();
    return { available: existing === null };
  },
});

// Check multiple handle suggestions and return only availability metadata.
export const checkHandles = query({
  args: { handles: v.array(v.string()) },
  handler: async (ctx, args) => {
    const uniqueHandles = [...new Set(args.handles.map((handle) => handle.trim().toLowerCase()))]
      .filter((handle) => handle.length >= 2);

    const results = await Promise.all(
      uniqueHandles.map(async (handle) => {
        const existing = await ctx.db
          .query("users")
          .withIndex("by_handle", (q) => q.eq("handle", handle))
          .unique();
        return {
          handle,
          available: existing === null,
        };
      })
    );

    return results;
  },
});

// Get current authenticated user
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerOrNull(ctx);
    if (!viewer) return null;

    // Only return the user if they've completed profile setup (have a handle).
    // If they only have the auth-created stub, return null so the frontend
    // shows the registration/profile-completion flow.
    if (!viewer.user.handle) return null;

    return viewer.user;
  },
});

// Sync user token (validates that authentication is still valid)
// Called after OAuth callback to ensure token is synced
export const syncToken = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // Token is valid; user is authenticated
    return { ok: true };
  },
});

// Admin: Delete user by email (for testing/maintenance)
export const adminDeleteByEmail = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .unique();

    if (!user) {
      return { error: "User not found" };
    }

    // Proceed with deletion
    deleteUserData(ctx, user);
    return { deleted: true };
  },
});

// Admin: Delete user by handle (for testing/maintenance)
export const adminDeleteByHandle = internalMutation({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .unique();

    if (!user) {
      return { error: "User not found" };
    }

    // Proceed with deletion
    deleteUserData(ctx, user);
    return { deleted: true };
  },
});

// Helper: Delete all user data
async function deleteUserData(ctx: any, user: any) {
  // Delete adoptions
  const adoptions = await ctx.db
    .query("adoptions")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .collect();
  for (const adoption of adoptions) {
    await ctx.db.delete(adoption._id);
  }

  // Delete diffs
  const diffs = await ctx.db
    .query("diffs")
    .withIndex("by_authorId", (q) => q.eq("authorId", user._id))
    .collect();
  for (const diff of diffs) {
    await ctx.db.delete(diff._id);
  }

  // Delete connection codes
  const codes = await ctx.db
    .query("connectionCodes")
    .filter((q) => q.eq(q.field("userId"), user._id))
    .collect();
  for (const code of codes) {
    await ctx.db.delete(code._id);
  }

  // Decrement company
  if (user.companyId) {
    const company = await ctx.db.get(user.companyId);
    if (company) {
      if (company.memberCount <= 1) {
        await ctx.db.delete(company._id);
      } else {
        await ctx.db.patch(company._id, {
          memberCount: company.memberCount - 1,
        });
      }
    }
  }

  // Delete auth accounts
  const authAccounts = await ctx.db
    .query("authAccounts")
    .filter((q) => q.eq(q.field("userId"), user._id))
    .collect();
  for (const account of authAccounts) {
    await ctx.db.delete(account._id);
  }

  // Delete user
  await ctx.db.delete(user._id);
}


// Update user profile
export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    role: v.optional(v.string()),
    function_: v.optional(v.string()),
    company: v.optional(v.string()),
    title: v.optional(v.string()),
    industry: v.optional(v.string()),
    seniority: v.optional(v.string()),
    summary: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    integrations: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { user } = await requireViewerForMutation(ctx);

    const updates: Record<string, unknown> = {};
    const canonicalTitle = getCanonicalTitle(args);
    if (args.displayName !== undefined) updates.displayName = args.displayName;
    if (args.function_ !== undefined) updates.function_ = args.function_;
    if (args.company !== undefined) updates.company = args.company;
    if (canonicalTitle !== undefined) {
      updates.title = canonicalTitle;
      updates.role = canonicalTitle;
    }
    if (args.industry !== undefined) updates.industry = args.industry;
    if (args.seniority !== undefined) updates.seniority = args.seniority;
    if (args.summary !== undefined) updates.summary = args.summary;
    if (args.linkedinUrl !== undefined) updates.linkedinUrl = args.linkedinUrl;
    if (args.photoUrl !== undefined) updates.photoUrl = args.photoUrl;
    if (args.integrations !== undefined) updates.integrations = args.integrations;

    await ctx.db.patch(user._id, updates);
    return user._id;
  },
});

// Delete account and all associated data (GDPR right to erasure)
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireViewerForMutation(ctx);

    // Delete all adoptions by this user
    const adoptions = await ctx.db
      .query("adoptions")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
    for (const adoption of adoptions) {
      await ctx.db.delete(adoption._id);
    }

    // Delete all diffs authored by this user
    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", user._id))
      .collect();
    for (const diff of diffs) {
      await ctx.db.delete(diff._id);
    }

    // Delete connection codes
    const codes = await ctx.db
      .query("connectionCodes")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();
    for (const code of codes) {
      await ctx.db.delete(code._id);
    }

    // Decrement company member count
    if (user.companyId) {
      const company = await ctx.db.get(user.companyId);
      if (company) {
        if (company.memberCount <= 1) {
          await ctx.db.delete(company._id);
        } else {
          await ctx.db.patch(company._id, {
            memberCount: company.memberCount - 1,
          });
        }
      }
    }

    // Delete auth accounts associated with this user
    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), user._id))
      .collect();
    for (const account of authAccounts) {
      await ctx.db.delete(account._id);
    }

    // Delete the user record
    await ctx.db.delete(user._id);

    return { deleted: true };
  },
});

export const setVisibility = mutation({
  args: {
    visibility: v.union(
      v.literal("private"),
      v.literal("colleagues"),
      v.literal("public")
    ),
  },
  handler: async (ctx, args) => {
    const { user } = await requireViewerForMutation(ctx);

    await ctx.db.patch(user._id, {
      visibility: args.visibility,
      isPublic: args.visibility === "public",
    });

    return { visibility: args.visibility };
  },
});

// Backward-compatible wrapper for existing callers.
export const togglePublic = mutation({
  args: { isPublic: v.boolean() },
  handler: async (ctx, args) => {
    const { user } = await requireViewerForMutation(ctx);

    await ctx.db.patch(user._id, {
      visibility: args.isPublic ? "public" : "private",
      isPublic: args.isPublic,
    });

    return {
      visibility: args.isPublic ? "public" : "private",
      isPublic: args.isPublic,
    };
  },
});
