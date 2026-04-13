import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Merge profile data from an orphan record into the auth-created record,
// then delete the orphan.
export const mergeAndDeleteOrphan = internalMutation({
  args: {
    authRecordId: v.id("users"),
    orphanRecordId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const authRecord = await ctx.db.get(args.authRecordId);
    const orphan = await ctx.db.get(args.orphanRecordId);

    if (!authRecord) return { error: "Auth record not found" };
    if (!orphan) return { error: "Orphan record not found" };

    // Merge orphan's profile fields into the auth record
    await ctx.db.patch(args.authRecordId, {
      displayName: orphan.displayName ?? authRecord.displayName,
      handle: orphan.handle ?? authRecord.handle,
      role: orphan.role ?? authRecord.role,
      function_: orphan.function_ ?? authRecord.function_,
      company: orphan.company ?? authRecord.company,
      companyId: orphan.companyId ?? authRecord.companyId,
      title: orphan.title ?? authRecord.title,
      industry: orphan.industry ?? authRecord.industry,
      seniority: orphan.seniority ?? authRecord.seniority,
      summary: orphan.summary ?? authRecord.summary,
      linkedinUrl: orphan.linkedinUrl ?? authRecord.linkedinUrl,
      photoUrl: orphan.photoUrl ?? authRecord.photoUrl,
      integrations: orphan.integrations ?? authRecord.integrations,
      source: orphan.source ?? authRecord.source,
      onboardingCompleted: orphan.onboardingCompleted ?? authRecord.onboardingCompleted,
      marketingOptOut: orphan.marketingOptOut ?? authRecord.marketingOptOut,
      domain: orphan.domain || authRecord.domain,
    });

    // Delete the orphan
    await ctx.db.delete(args.orphanRecordId);

    return {
      merged: true,
      authRecordId: args.authRecordId,
      deletedOrphan: args.orphanRecordId,
      handle: orphan.handle,
    };
  },
});
