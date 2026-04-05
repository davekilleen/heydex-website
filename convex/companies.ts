import { v } from "convex/values";
import { query } from "./_generated/server";

// Get company view for the authenticated user's domain
export const myCompany = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();

    if (!user || !user.companyId) return null;

    const company = await ctx.db.get(user.companyId);
    if (!company) return null;

    // Get all users at this domain
    const colleagues = await ctx.db
      .query("users")
      .withIndex("by_domain", (q) => q.eq("domain", user.domain))
      .take(200);

    // Get all diffs published by colleagues
    const colleagueDiffs = [];
    for (const colleague of colleagues) {
      const diffs = await ctx.db
        .query("diffs")
        .withIndex("by_authorId", (q) => q.eq("authorId", colleague._id))
        .take(20);

      for (const diff of diffs) {
        if (diff.status === "published") {
          colleagueDiffs.push({
            diffId: diff.diffId,
            authorHandle: diff.authorHandle,
            authorName: colleague.displayName,
            name: diff.name,
            description: diff.description,
            adoptionCount: diff.adoptionCount,
            publishedAt: diff.publishedAt,
          });
        }
      }
    }

    // Aggregate integrations across colleagues
    const integrationMap: Record<string, string[]> = {};
    for (const colleague of colleagues) {
      if (colleague.integrations) {
        for (const integration of colleague.integrations) {
          if (!integrationMap[integration]) {
            integrationMap[integration] = [];
          }
          integrationMap[integration].push(colleague.displayName);
        }
      }
    }

    // Aggregate by function
    const functionBreakdown: Record<string, number> = {};
    for (const colleague of colleagues) {
      const fn = colleague.function_ ?? "Other";
      functionBreakdown[fn] = (functionBreakdown[fn] ?? 0) + 1;
    }

    return {
      domain: company.domain,
      displayName: company.displayName,
      memberCount: company.memberCount,
      colleagues: colleagues.map((c) => ({
        handle: c.handle,
        displayName: c.displayName,
        role: c.role,
        function_: c.function_,
      })),
      diffs: colleagueDiffs,
      integrations: integrationMap,
      functionBreakdown,
    };
  },
});
