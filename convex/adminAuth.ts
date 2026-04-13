import { mutation } from "./_generated/server";

export const cleanupGhostAuth = mutation({
  async handler(ctx) {
    // Find auth accounts where userId doesn't exist in users table
    const accounts = await ctx.db.query("authAccounts").collect();
    const deleted = [];
    
    for (const account of accounts) {
      if (account.userId) {
        const user = await ctx.db.get(account.userId);
        if (!user) {
          await ctx.db.delete(account._id);
          deleted.push(account.userId);
        }
      }
    }
    
    return { deleted, count: deleted.length };
  },
});
