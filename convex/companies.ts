import { Doc } from "./_generated/dataModel";
import { QueryCtx, query } from "./_generated/server";
import { getViewerOrNull } from "./viewer";

function getEffectiveVisibility(user: {
  visibility?: "private" | "colleagues" | "public";
  isPublic?: boolean;
}) {
  return user.visibility ?? (user.isPublic ? "public" : "private");
}

function isVisibleCompanyMember(user: Doc<"users">) {
  const visibility = getEffectiveVisibility(user);
  return visibility === "colleagues" || visibility === "public";
}

export async function getCompanyViewForUser(ctx: QueryCtx, user: Doc<"users">) {
  if (!user.companyId) return null;

  const company = await ctx.db.get(user.companyId);
  if (!company) return null;

  const domain = user.domain ?? company.domain;
  if (!domain) return null;

  // Raw domain membership is allowed only as a non-identifying count.
  const domainUsers = await ctx.db
    .query("users")
    .withIndex("by_domain", (q) => q.eq("domain", domain))
    .collect();
  const visibleMembers = domainUsers.filter(isVisibleCompanyMember);

  // Get diffs published by opted-in company members only.
  const companyDiffs = [];
  for (const member of visibleMembers) {
    const diffs = await ctx.db
      .query("diffs")
      .withIndex("by_authorId", (q) => q.eq("authorId", member._id))
      .take(100);

    for (const diff of diffs) {
      if (diff.status === "published") {
        companyDiffs.push({
          diffId: diff.diffId,
          authorHandle: diff.authorHandle,
          authorName: member.displayName,
          name: diff.name,
          description: diff.description,
          adoptionCount: diff.adoptionCount,
          publishedAt: diff.publishedAt,
        });
      }
    }
  }

  companyDiffs.sort((left, right) => {
    const leftPublishedAt = left.publishedAt ?? 0;
    const rightPublishedAt = right.publishedAt ?? 0;
    return rightPublishedAt - leftPublishedAt;
  });

  // Aggregate integrations across opted-in members only.
  const integrationMap: Record<string, string[]> = {};
  for (const member of visibleMembers) {
    if (member.integrations) {
      for (const integration of member.integrations) {
        if (!integrationMap[integration]) {
          integrationMap[integration] = [];
        }
        integrationMap[integration].push(member.displayName ?? member.handle ?? "");
      }
    }
  }

  // Aggregate functions across opted-in members only.
  const functionBreakdown: Record<string, number> = {};
  for (const member of visibleMembers) {
    const fn = member.function_ ?? "Other";
    functionBreakdown[fn] = (functionBreakdown[fn] ?? 0) + 1;
  }

  return {
    domain: company.domain,
    displayName: company.displayName,
    memberCount: domainUsers.length,
    colleagues: visibleMembers.map((member) => ({
      handle: member.handle,
      displayName: member.displayName,
      role: member.role,
      function_: member.function_,
    })),
    diffs: companyDiffs,
    integrations: integrationMap,
    functionBreakdown,
  };
}

// Get company view for the authenticated user's domain
export const myCompany = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewerOrNull(ctx);
    if (!viewer || !viewer.user.companyId) return null;
    return await getCompanyViewForUser(ctx, viewer.user);
  },
});
