import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

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

    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
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

    return new Response(JSON.stringify(diffs), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// POST /api/connect/redeem — exchange a connection code for user info
// Used by the CLI after user pastes their code
http.route({
  path: "/api/connect/redeem",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
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

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
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

export default http;
