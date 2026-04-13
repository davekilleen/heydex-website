import { internalMutation } from "./_generated/server";

export const cleanupOrphanAuth = internalMutation({
  async handler(ctx) {
    // Find all authAccounts where the userId doesn't exist
    const accounts = await ctx.db.query("authAccounts").collect();
    let cleaned = 0;
    
    for (const account of accounts) {
      if (account.userId) {
        const user = await ctx.db.get(account.userId);
        if (!user) {
          await ctx.db.delete(account._id);
          cleaned++;
        }
      }
    }
    
    return { message: `Cleaned ${cleaned} orphaned auth records` };
  },
});
