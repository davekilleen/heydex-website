import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

// Simple in-memory rate limiter (resets on deploy)
const redemptionAttempts = new Map<string, number[]>();
const TEST_SECRET_HEADER = "x-heydex-test-secret";

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const attempts = redemptionAttempts.get(ip) || [];
  
  // Remove attempts older than 1 minute
  const recentAttempts = attempts.filter(t => now - t < 60000);
  
  if (recentAttempts.length >= 10) {
    return false; // Rate limited
  }
  
  recentAttempts.push(now);
  redemptionAttempts.set(ip, recentAttempts);
  return true;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
  });
}

function getConfiguredTestSecret() {
  return process.env.E2E_TEST_SECRET?.trim() || "";
}

function authorizeTestHarness(req: Request) {
  const configuredSecret = getConfiguredTestSecret();
  if (!configuredSecret) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  const providedSecret = req.headers.get(TEST_SECRET_HEADER);
  if (providedSecret !== configuredSecret) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  return null;
}

// Convex Auth routes (sign-in, sign-out, OAuth callbacks)
auth.addHttpRoutes(http);

// GET /api/diffs/:author/:diffId — fetch a single diff's methodology YAML
// Used by the CLI: /diff-adopt @author/diff-id
http.route({
  path: "/api/diff",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const authorHandle = url.searchParams.get("author");
    const diffId = url.searchParams.get("id");

    if (!authorHandle || !diffId) {
      return new Response(
        JSON.stringify({ error: "Missing author or id parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const diff = await ctx.runQuery(api.diffs.get, { authorHandle, diffId });

    if (!diff) {
      return new Response(
        JSON.stringify({ error: "Diff not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Return the raw methodology YAML
    return new Response(diff.methodology, {
      status: 200,
      headers: {
        "Content-Type": "text/yaml",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// GET /api/profile?handle=dave — fetch a user's profile with their diffs
// Used by the CLI: /diff-adopt-profile @handle
http.route({
  path: "/api/profile",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const handle = url.searchParams.get("handle");

    if (!handle) {
      return new Response(
        JSON.stringify({ error: "Missing handle parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const profile = await ctx.runQuery(api.profiles.get, { handle });

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return jsonResponse(profile);
  }),
});

// GET /api/profile-bundle?handle=dave — fetch the full profile clone payload
// Used by the CLI: /diff-adopt-profile @handle
http.route({
  path: "/api/profile-bundle",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const handle = url.searchParams.get("handle");

    if (!handle) {
      return new Response(
        JSON.stringify({ error: "Missing handle parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const bundle = await ctx.runQuery(api.profiles.getBundle, { handle });

    if (!bundle) {
      return new Response(
        JSON.stringify({ error: "Profile bundle not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return jsonResponse(bundle);
  }),
});

// GET /api/diffs — list published diffs (optional role filter)
http.route({
  path: "/api/diffs",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") ?? undefined;

    const diffs = await ctx.runQuery(api.diffs.list, { role });

    return jsonResponse(diffs);
  }),
});

// POST /api/connect/redeem — exchange a connection code for user info
// Used by the CLI after user pastes their code
http.route({
  path: "/api/connect/redeem",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Get IP from headers
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    
    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in 1 minute." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const code = body?.code;

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing code" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await ctx.runMutation(api.connect.redeemCode, { code });

    if ("error" in result) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    return jsonResponse(result);
  }),
});

// POST /api/review/create - Create review session
http.route({
  path: "/api/review/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const { sessionToken, tokenIdentifier, diffs } = body ?? {};

    if ((!sessionToken && !tokenIdentifier) || !diffs) {
      return new Response(
        JSON.stringify({ error: "Missing sessionToken or diffs" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let result;
    try {
      result = await ctx.runMutation(api.review.createSession, {
        sessionToken,
        tokenIdentifier,
        diffs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create review session";
      if (message.includes("User not found")) {
        return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return jsonResponse(result);
  }),
});

// GET /api/review/status - Check if session has been published
http.route({
  path: "/api/review/status",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const session = url.searchParams.get("session");

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Missing session parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await ctx.runQuery(api.review.checkPublished, {
      sessionCode: session,
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/api/test/bootstrap-cli",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createCliSession, {
      handle: typeof body?.handle === "string" ? body.handle : undefined,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      company: typeof body?.company === "string" ? body.company : undefined,
      summary: typeof body?.summary === "string" ? body.summary : undefined,
      linkedinUrl: typeof body?.linkedinUrl === "string" ? body.linkedinUrl : undefined,
      photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl : undefined,
      expired: body?.expired === true,
      visibility:
        body?.visibility === "private" ||
        body?.visibility === "colleagues" ||
        body?.visibility === "public"
          ? body.visibility
          : undefined,
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/api/test/bootstrap-connect-code",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createConnectionCode, {
      handle: typeof body?.handle === "string" ? body.handle : undefined,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      company: typeof body?.company === "string" ? body.company : undefined,
      summary: typeof body?.summary === "string" ? body.summary : undefined,
      linkedinUrl: typeof body?.linkedinUrl === "string" ? body.linkedinUrl : undefined,
      photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl : undefined,
      visibility:
        body?.visibility === "private" ||
        body?.visibility === "colleagues" ||
        body?.visibility === "public"
          ? body.visibility
          : undefined,
      expired: body?.expired === true,
      redeemed: body?.redeemed === true,
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/api/test/bootstrap-review",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createReviewSession, {
      handle: typeof body?.handle === "string" ? body.handle : undefined,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      company: typeof body?.company === "string" ? body.company : undefined,
      summary: typeof body?.summary === "string" ? body.summary : undefined,
      linkedinUrl: typeof body?.linkedinUrl === "string" ? body.linkedinUrl : undefined,
      photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl : undefined,
      visibility:
        body?.visibility === "private" ||
        body?.visibility === "colleagues" ||
        body?.visibility === "public"
          ? body.visibility
          : undefined,
      expired: body?.expired === true,
      diffs: Array.isArray(body?.diffs) ? body.diffs : undefined,
    });

    return jsonResponse({
      ...result,
      reviewUrl: `/diff/review/?session=${result.sessionCode}`,
    });
  }),
});

http.route({
  path: "/api/test/bootstrap-public-profile",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createPublicProfileBundle, {
      handle: typeof body?.handle === "string" ? body.handle : undefined,
      displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
      title: typeof body?.title === "string" ? body.title : undefined,
      company: typeof body?.company === "string" ? body.company : undefined,
      summary: typeof body?.summary === "string" ? body.summary : undefined,
      linkedinUrl: typeof body?.linkedinUrl === "string" ? body.linkedinUrl : undefined,
      photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl : undefined,
      loveLetter: typeof body?.loveLetter === "string" ? body.loveLetter : undefined,
      visibility:
        body?.visibility === "private" ||
        body?.visibility === "colleagues" ||
        body?.visibility === "public"
          ? body.visibility
          : undefined,
      diffs: Array.isArray(body?.diffs) ? body.diffs : undefined,
    });

    return jsonResponse(result);
  }),
});

http.route({
  path: "/api/test/bootstrap-adoption",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email : undefined;
    const authorHandle =
      typeof body?.authorHandle === "string" ? body.authorHandle : undefined;
    const diffSlug = typeof body?.diffSlug === "string" ? body.diffSlug : undefined;

    if (!email || !authorHandle || !diffSlug) {
      return jsonResponse(
        { error: "email, authorHandle, and diffSlug are required" },
        400
      );
    }

    const result = await ctx.runMutation(
      internal.testHarness.createAdoptionForEmail,
      {
        email,
        authorHandle,
        diffSlug,
      }
    );

    return jsonResponse(result);
  }),
});

// POST /api/publish — publish a diff, authenticated via connection code
// Used by the CLI: /diff-push
http.route({
  path: "/api/publish",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const { code, diffId, name, description, methodology, tags, roles, integrations } = body ?? {};

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing connection code" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!diffId || !name || !methodology) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: diffId, name, methodology" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Redeem the connection code to authenticate the user
    const authResult = await ctx.runMutation(api.connect.redeemCode, { code });

    if ("error" in authResult) {
      return new Response(
        JSON.stringify({ error: authResult.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!authResult.handle) {
      return new Response(
        JSON.stringify({ error: "Complete registration first" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Publish the diff on behalf of the authenticated user
    const result = await ctx.runMutation(api.diffs.publishViaCode, {
      userHandle: authResult.handle,
      diffId,
      name,
      description: description ?? "",
      methodology,
      tags: tags ?? [],
      roles: roles ?? [],
      integrations: integrations ?? [],
    });

    if ("error" in result) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/love-letter — submit a love letter, authenticated via connection code
http.route({
  path: "/api/love-letter",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const { code, text } = body ?? {};

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing connection code" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing love letter text" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Redeem the connection code to authenticate the user
    const authResult = await ctx.runMutation(api.connect.redeemCode, { code });

    if ("error" in authResult) {
      return new Response(
        JSON.stringify({ error: authResult.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!authResult.handle) {
      return new Response(
        JSON.stringify({ error: "Complete registration first" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Look up the user by handle to get their userId
    const user = await ctx.runQuery(internal.users.getByHandle, {
      handle: authResult.handle!,
    });

    if (!user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await ctx.runMutation(internal.loveLetters.submit, {
      userId: user._id,
      text: text.trim(),
    });

    if (result && "error" in result) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, handle: authResult.handle }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }),
});

// GET /api/love-letters — public list of published love letters with optional filters
http.route({
  path: "/api/love-letters",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const url = new URL(req.url);
    const function_ = url.searchParams.get("function") ?? undefined;
    const seniority = url.searchParams.get("seniority") ?? undefined;
    const diffSlug = url.searchParams.get("diffSlug") ?? undefined;
    const handle = url.searchParams.get("handle") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const letters = await ctx.runQuery(api.loveLetters.list, {
      function_,
      seniority,
      diffSlug,
      handle,
      limit,
    });

    return new Response(JSON.stringify(letters), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// CORS preflight for love-letter endpoints
http.route({
  path: "/api/love-letter",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

http.route({
  path: "/api/love-letters",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// CORS preflight for POST endpoints
const corsPreflightHandler = httpAction(async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
});

http.route({
  path: "/api/connect/redeem",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

http.route({
  path: "/api/publish",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

http.route({
  path: "/api/review/create",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

http.route({
  path: "/api/test/bootstrap-cli",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, ${TEST_SECRET_HEADER}`,
      },
    });
  }),
});

http.route({
  path: "/api/test/bootstrap-connect-code",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, ${TEST_SECRET_HEADER}`,
      },
    });
  }),
});

http.route({
  path: "/api/test/bootstrap-review",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, ${TEST_SECRET_HEADER}`,
      },
    });
  }),
});

http.route({
  path: "/api/test/bootstrap-public-profile",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": `Content-Type, ${TEST_SECRET_HEADER}`,
      },
    });
  }),
});

export default http;
