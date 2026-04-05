import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// Seed a diff by fetching its YAML from a URL
// This avoids passing large YAML content as CLI args
export const seedFromUrl = internalAction({
  args: {
    diffId: v.string(),
    name: v.string(),
    description: v.string(),
    yamlUrl: v.string(),
    tags: v.array(v.string()),
    roles: v.array(v.string()),
    integrations: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const res = await fetch(args.yamlUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${args.yamlUrl}: ${res.status}`);
    }
    const methodology = await res.text();

    await ctx.runMutation(internal.seed.seedDiff, {
      diffId: args.diffId,
      name: args.name,
      description: args.description,
      methodology,
      tags: args.tags,
      roles: args.roles,
      integrations: args.integrations,
    });

    return { message: `Seeded ${args.diffId}`, yamlLength: methodology.length };
  },
});
