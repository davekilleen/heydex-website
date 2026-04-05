import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Seed Dave's user and company — run once via dashboard
export const seedDave = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Check if Dave already exists
    const existing = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", "dave"))
      .unique();

    if (existing) {
      return { message: "Dave already seeded", userId: existing._id };
    }

    // Create company
    const companyId = await ctx.db.insert("companies", {
      domain: "pendo.io",
      displayName: "Pendo",
      memberCount: 1,
    });

    // Create Dave's user (tokenIdentifier is placeholder — will be linked on first real login)
    const userId = await ctx.db.insert("users", {
      email: "dave@pendo.io",
      domain: "pendo.io",
      displayName: "Dave Killeen",
      handle: "dave",
      role: "Field CPO, EMEA",
      function_: "Product",
      company: "Pendo",
      companyId,
      linkedinUrl: "https://linkedin.com/in/davekilleen",
      integrations: ["slack", "gmail", "calendar", "granola", "salesforce"],
      tokenIdentifier: "seed:dave",
    });

    return { message: "Dave seeded", userId };
  },
});

// Seed a single diff — call for each of Dave's 7 diffs
export const seedDiff = internalMutation({
  args: {
    diffId: v.string(),
    name: v.string(),
    description: v.string(),
    methodology: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const dave = await ctx.db
      .query("users")
      .withIndex("by_handle", (q) => q.eq("handle", "dave"))
      .unique();

    if (!dave) {
      throw new Error("Seed Dave first");
    }

    // Check if diff already exists
    const existing = await ctx.db
      .query("diffs")
      .withIndex("by_authorHandle_and_diffId", (q) =>
        q.eq("authorHandle", "dave").eq("diffId", args.diffId)
      )
      .unique();

    if (existing) {
      // Update existing
      await ctx.db.patch(existing._id, {
        name: args.name,
        description: args.description,
        methodology: args.methodology,
        tags: args.tags,
        roles: args.roles,
        integrations: args.integrations,
      });
      return { message: `Updated ${args.diffId}`, diffDocId: existing._id };
    }

    const diffDocId = await ctx.db.insert("diffs", {
      diffId: args.diffId,
      authorId: dave._id,
      authorHandle: "dave",
      name: args.name,
      description: args.description,
      methodology: args.methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
      basedOn: undefined,
      adoptionCount: 0,
      activeUserCount: 0,
      status: "published",
      publishedAt: Date.now(),
    });

    return { message: `Seeded ${args.diffId}`, diffDocId };
  },
});
