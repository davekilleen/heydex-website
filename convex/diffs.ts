import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

// Fetch a single diff by @author/diff-id
export const get = query({
  args: {
    authorHandle: v.string(),
    diffId: v.string(),
  },
  handler: async (ctx, args) => {
    const diff = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.authorHandle).eq("diffId", args.diffId)
      )
      .unique();

    if (!diff || diff.status !== "published") {
      return null;
    }

    return {
      diffId: diff.diffId,
      authorHandle: diff.authorHandle,
      name: diff.name,
      description: diff.description,
      methodology: diff.methodology,
      tags: diff.tags,
      roles: diff.roles,
      integrations: diff.integrations,
      adoptionCount: diff.adoptionCount,
      activeUserCount: diff.activeUserCount,
      publishedAt: diff.publishedAt,
    };
  },
});

// List all published diffs (community browse)
export const list = query({
  args: {
    role: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_status", (q) => q.eq("status", "published"))
      .order("desc")
      .take(limit);

    const results = args.role
      ? diffs.filter((d) => d.roles.includes(args.role!))
      : diffs;

    return results.map((d) => ({
      diffId: d.diffId,
      authorHandle: d.authorHandle,
      name: d.name,
      description: d.description,
      tags: d.tags,
      roles: d.roles,
      adoptionCount: d.adoptionCount,
      publishedAt: d.publishedAt,
    }));
  },
});

// List diffs by a specific author
export const listByAuthor = query({
  args: { authorHandle: v.string() },
  handler: async (ctx, args) => {
    const author = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.authorHandle))
      .unique();

    if (!author) return [];

    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", author._id))
      .take(50);

    return diffs
      .filter((d) => d.status === "published")
      .map((d) => ({
        diffId: d.diffId,
        authorHandle: d.authorHandle,
        name: d.name,
        description: d.description,
        tags: d.tags,
        roles: d.roles,
        adoptionCount: d.adoptionCount,
        publishedAt: d.publishedAt,
      }));
  },
});

// Publish a diff via connection code (used by CLI /diff-push)
// The HTTP endpoint validates the code and passes the user handle.
export const publishViaCode = mutation({
  args: {
    userHandle: v.string(),
    diffId: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.userHandle))
      .unique();

    if (!user) {
      return { error: "User not found for handle: " + args.userHandle };
    }

    // Check for existing diff with same ID by this author
    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.userHandle).eq("diffId", args.diffId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        methodology: args.methodology,
        tags: args.tags,
        roles: args.roles,
        integrations: args.integrations,
        status: "published" as const,
        publishedAt: Date.now(),
      });
      return { id: existing._id, updated: true, diffId: args.diffId, authorHandle: args.userHandle };
    }

    const diffDocId = await ctx.db.insert("diffs", {
      diffId: args.diffId,
      authorId: user._id,
      authorHandle: args.userHandle,
      name: args.name,
      description: args.description,
      methodology: args.methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
      adoptionCount: 0,
      activeUserCount: 0,
      status: "published",
      publishedAt: Date.now(),
    });

    return { id: diffDocId, updated: false, diffId: args.diffId, authorHandle: args.userHandle };
  },
});

// Publish a new diff (requires auth)
export const publish = mutation({
  args: {
    diffId: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
    basedOn: v.optional(v.id("diffs")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user) {
      throw new Error("User not found — register first");
    }

    // Check for existing diff with same ID by this author
    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", user.handle).eq("diffId", args.diffId)
      )
      .unique();

    if (existing) {
      // Update existing diff
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        methodology: args.methodology,
        tags: args.tags,
        roles: args.roles,
        integrations: args.integrations,
        basedOn: args.basedOn,
        status: "published" as const,
        publishedAt: Date.now(),
      });
      return existing._id;
    }

    // Create new diff
    const diffDocId = await ctx.db.insert("diffs", {
      diffId: args.diffId,
      authorId: user._id,
      authorHandle: user.handle,
      name: args.name,
      description: args.description,
      methodology: args.methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
      basedOn: args.basedOn,
      adoptionCount: 0,
      activeUserCount: 0,
      status: "published",
      publishedAt: Date.now(),
    });

    return diffDocId;
  },
});

// Migration helper: Insert a diff directly (for dev→prod migration)
// Only callable by admin/backend scripts
export const migrateFromDev = mutation({
  args: {
    diffId: v.string(),
    authorHandle: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Find or create user by handle
    const user = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", args.authorHandle))
      .unique();

    if (!user) {
      return { error: `User not found: ${args.authorHandle}` };
    }

    // Check if diff already exists
    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", args.authorHandle).eq("diffId", args.diffId)
      )
      .unique();

    if (existing) {
      // Update if exists
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        methodology: args.methodology,
        tags: args.tags,
        roles: args.roles,
        integrations: args.integrations,
        status: "published",
        publishedAt: Date.now(),
      });
      return { id: existing._id, updated: true };
    }

    // Create new diff
    const diffDocId = await ctx.db.insert("diffs", {
      diffId: args.diffId,
      authorId: user._id,
      authorHandle: args.authorHandle,
      name: args.name,
      description: args.description,
      methodology: args.methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
      adoptionCount: 0,
      activeUserCount: 0,
      status: "published",
      publishedAt: Date.now(),
    });

    return { id: diffDocId, updated: false };
  },
});
