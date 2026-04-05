import Google from "@auth/core/providers/google";
import Apple from "@auth/core/providers/apple";
import { convexAuth } from "@convex-dev/auth/server";

// Microsoft Entra ID configured manually to work around profilePhotoSize bug in @auth/core 0.37.4
const MicrosoftEntraId = {
  id: "microsoft-entra-id",
  name: "Microsoft Entra ID",
  type: "oidc" as const,
  issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID || "common"}/v2.0`,
  clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_CLIENT_ID,
  clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_CLIENT_SECRET,
  authorization: {
    params: { scope: "openid profile email User.Read" },
  },
  profile(profile: any) {
    return {
      id: profile.sub,
      name: profile.name,
      email: profile.email,
      image: null,
    };
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google, Apple, MicrosoftEntraId],
  jwt: {
    async customClaims(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      return {
        email: user?.email ?? undefined,
        name: user?.name ?? user?.displayName ?? undefined,
      };
    },
  },
});

// Logging wrapper for debugging auth issues
export const debugAuthSignIn = async (
  provider: string,
  redirectTo: string
) => {
  console.log(`[AUTH DEBUG] signIn called - provider: ${provider}, redirectTo: ${redirectTo}`);
  try {
    const result = await (signIn as any)({ provider, params: { redirectTo } });
    console.log(`[AUTH DEBUG] signIn result:`, JSON.stringify(result, null, 2));
    return result;
  } catch (err) {
    console.error(`[AUTH DEBUG] signIn error:`, err);
    throw err;
  }
};
