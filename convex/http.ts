import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import { isBetaGateDisabled } from "./lib/beta";
import { isTestHarnessEnvironment } from "./lib/environment";

const http = httpRouter();

// Simple in-memory rate limiter (resets on deploy)
const redemptionAttempts = new Map<string, number[]>();
const TEST_SECRET_HEADER = "x-heydex-test-secret";
const MAX_ADOPTION_BODY_BYTES = 32 * 1024;
const INVALID_ADOPTION_REQUEST_BODY = {
  error: "invalid_request",
  code: "INVALID_REQUEST",
};

function registerTestRoute(route: any) {
  if (!isTestHarnessEnvironment()) {
    return;
  }
  http.route(route);
}

type AdoptionRequest = {
  authorHandle: string;
  diffIds: string[];
  source: string;
  contractVersion: string;
};

type ProfileBundleRedeemRequest = {
  code: string;
  handle: string;
};

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

function invalidAdoptionRequestResponse() {
  return jsonResponse(INVALID_ADOPTION_REQUEST_BODY, 400);
}

function warnInvalidAdoptionRequest(reason: string) {
  console.warn("[adoptions] invalid_request", { reason });
}

function warnInvalidProfileBundleRedeemRequest(reason: string) {
  console.warn("[profile-bundle/redeem] invalid_request", { reason });
}

function getConfiguredTestSecret() {
  return process.env.E2E_TEST_SECRET?.trim() || "";
}

function betaDeniedResponse(status = 403) {
  return jsonResponse(
    {
      error: "You're not in the DexDiff beta yet.",
      code: "BETA_ACCESS_DENIED",
    },
    status,
  );
}

async function resolveHttpBetaUser(ctx: any, req: Request) {
  if (isBetaGateDisabled()) {
    return { user: null, error: null };
  }

  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { user: null, error: betaDeniedResponse(401) };
  }

  try {
    const user = await ctx.runMutation(internal.connect.resolveCliSession, {
      sessionToken: match[1],
    });
    if (!user) {
      return { user: null, error: betaDeniedResponse(401) };
    }
    return { user, error: null };
  } catch {
    return { user: null, error: betaDeniedResponse() };
  }
}

async function resolveRequiredHttpBetaUser(ctx: any, req: Request) {
  const authorization = req.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { user: null, error: betaDeniedResponse(401) };
  }

  try {
    const user = await ctx.runMutation(internal.connect.resolveCliSession, {
      sessionToken: match[1],
    });
    if (!user) {
      return { user: null, error: betaDeniedResponse(401) };
    }
    return { user, error: null };
  } catch {
    return { user: null, error: betaDeniedResponse() };
  }
}

async function redeemCodeForHttp(ctx: any, code: string, ip: string) {
  if (!checkRateLimit(ip)) {
    return {
      result: null,
      error: jsonResponse(
        { error: "Too many attempts. Try again in 1 minute." },
        429,
      ),
    };
  }

  try {
    return {
      result: await ctx.runMutation(internal.connect.redeemCode, { code }),
      error: null,
    };
  } catch {
    return { result: null, error: betaDeniedResponse() };
  }
}

function authorizeTestHarness(req: Request) {
  if (!isTestHarnessEnvironment()) {
    return jsonResponse({ error: "Not found" }, 404);
  }
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

function normalizeHandleParam(handle: string): string {
  let decoded = handle;
  try {
    decoded = decodeURIComponent(handle);
  } catch {
    decoded = handle;
  }
  return decoded.trim().replace(/^@/, "");
}

function parseVisibility(value: unknown) {
  return value === "private" || value === "colleagues" || value === "public"
    ? value
    : undefined;
}

function parseHarnessUserFields(body: any) {
  return {
    handle: typeof body?.handle === "string" ? body.handle : undefined,
    email: typeof body?.email === "string" ? body.email : undefined,
    domain: typeof body?.domain === "string" ? body.domain : undefined,
    displayName: typeof body?.displayName === "string" ? body.displayName : undefined,
    title: typeof body?.title === "string" ? body.title : undefined,
    function_: typeof body?.function_ === "string" ? body.function_ : undefined,
    company: typeof body?.company === "string" ? body.company : undefined,
    summary: typeof body?.summary === "string" ? body.summary : undefined,
    linkedinUrl: typeof body?.linkedinUrl === "string" ? body.linkedinUrl : undefined,
    photoUrl: typeof body?.photoUrl === "string" ? body.photoUrl : undefined,
    integrations: Array.isArray(body?.integrations) ? body.integrations : undefined,
    visibility: parseVisibility(body?.visibility),
  };
}

function parseHarnessCompanyMember(body: any) {
  return {
    ...parseHarnessUserFields(body),
    handle: typeof body?.handle === "string" ? body.handle : undefined,
    diffs: Array.isArray(body?.diffs) ? body.diffs : undefined,
  };
}

async function readCappedRequestText(req: Request, maxBytes: number):
  Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      return { ok: false, reason: "invalid_content_length" };
    }
    if (parsedLength > maxBytes) {
      return { ok: false, reason: "content_length_exceeds_cap" };
    }
  }

  const reader = req.body?.getReader();
  if (!reader) {
    const body = await req.arrayBuffer();
    if (body.byteLength > maxBytes) {
      return { ok: false, reason: "body_exceeds_cap" };
    }
    return { ok: true, text: new TextDecoder().decode(body) };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "body_exceeds_cap" };
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { ok: true, text: new TextDecoder().decode(body) };
}

function parseCappedJsonRequestBody(text: string):
  | { ok: true; body: unknown }
  | { ok: false; reason: string } {
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

function shapeAdoptionRequest(body: unknown):
  | { ok: true; value: AdoptionRequest }
  | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "body_not_object" };
  }

  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.diffIds)) {
    return { ok: false, reason: "diff_ids_not_array" };
  }
  if (
    !record.diffIds.every(
      (diffId): diffId is string => typeof diffId === "string"
    )
  ) {
    return { ok: false, reason: "diff_ids_not_strings" };
  }

  return {
    ok: true,
    value: {
      authorHandle:
        typeof record.authorHandle === "string"
          ? normalizeHandleParam(record.authorHandle)
          : "",
      diffIds: record.diffIds,
      source: typeof record.source === "string" ? record.source.trim() : "",
      contractVersion:
        typeof record.contractVersion === "string" ? record.contractVersion : "",
    },
  };
}

function shapeProfileBundleRedeemRequest(body: unknown):
  | { ok: true; value: ProfileBundleRedeemRequest }
  | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, reason: "body_not_object" };
  }

  const record = body as Record<string, unknown>;
  if (typeof record.code !== "string" || record.code.trim().length === 0) {
    return { ok: false, reason: "code_missing" };
  }
  if (typeof record.handle !== "string" || record.handle.trim().length === 0) {
    return { ok: false, reason: "handle_missing" };
  }

  return {
    ok: true,
    value: {
      code: record.code,
      handle: record.handle,
    },
  };
}

// Convex Auth routes (sign-in, sign-out, OAuth callbacks)
auth.addHttpRoutes(http);

// GET /api/diffs/:author/:diffId - fetch a single diff's methodology YAML
// Used by the CLI: /diff-adopt @author/diff-id
http.route({
  path: "/api/diff",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const rawAuthorHandle = url.searchParams.get("author");
    const authorHandle = rawAuthorHandle
      ? normalizeHandleParam(rawAuthorHandle)
      : null;
    const diffId = url.searchParams.get("id");

    if (!authorHandle || !diffId) {
      return new Response(
        JSON.stringify({ error: "Missing author or id parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const diff = betaAccess.user
      ? await ctx.runQuery(internal.diffs.getForBetaUser, {
          betaUserId: betaAccess.user._id,
          authorHandle,
          diffId,
        })
      : await ctx.runQuery(api.diffs.get, { authorHandle, diffId });

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

// GET /api/profile?handle=dave - fetch a user's profile with their diffs
// Used by the CLI: /diff-adopt-profile @handle
http.route({
  path: "/api/profile",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const rawHandle = url.searchParams.get("handle");
    const handle = rawHandle ? normalizeHandleParam(rawHandle) : null;

    if (!handle) {
      return new Response(
        JSON.stringify({ error: "Missing handle parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const profile = betaAccess.user
      ? await ctx.runQuery(internal.profiles.getForBetaUser, {
          betaUserId: betaAccess.user._id,
          handle,
        })
      : await ctx.runQuery(api.profiles.get, { handle });

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return jsonResponse(profile);
  }),
});

// GET /api/profile-bundle?handle=dave - fetch the full profile clone payload
// Used by the CLI: /diff-adopt-profile @handle
http.route({
  path: "/api/profile-bundle",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const rawHandle = url.searchParams.get("handle");
    const handle = rawHandle ? normalizeHandleParam(rawHandle) : null;

    if (!handle) {
      return new Response(
        JSON.stringify({ error: "Missing handle parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const bundle = betaAccess.user
      ? await ctx.runQuery(internal.profiles.getBundleForBetaUser, {
          betaUserId: betaAccess.user._id,
          handle,
        })
      : await ctx.runQuery(api.profiles.getBundle, { handle });

    if (!bundle) {
      return new Response(
        JSON.stringify({ error: "Profile bundle not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    return jsonResponse(bundle);
  }),
});

// POST /api/profile-bundle/redeem - exchange an adopt grant for a private bundle
http.route({
  path: "/api/profile-bundle/redeem",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveRequiredHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;

    const ip = req.headers.get("x-forwarded-for") || "unknown";

    if (!checkRateLimit(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in 1 minute." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const rawBody = await readCappedRequestText(req, MAX_ADOPTION_BODY_BYTES);
    if (!rawBody.ok) {
      warnInvalidProfileBundleRedeemRequest(rawBody.reason);
      return invalidAdoptionRequestResponse();
    }

    const parsedBody = parseCappedJsonRequestBody(rawBody.text);
    if (!parsedBody.ok) {
      warnInvalidProfileBundleRedeemRequest(parsedBody.reason);
      return invalidAdoptionRequestResponse();
    }

    const shaped = shapeProfileBundleRedeemRequest(parsedBody.body);
    if (!shaped.ok) {
      warnInvalidProfileBundleRedeemRequest(shaped.reason);
      return invalidAdoptionRequestResponse();
    }

    let result;
    try {
      result = await ctx.runMutation(internal.adopt.redeemGrant, {
        ...shaped.value,
        recipientUserId: betaAccess.user._id,
      });
    } catch (error) {
      warnInvalidProfileBundleRedeemRequest(
        error instanceof Error
          ? `mutation_exception:${error.message}`
          : "mutation_exception"
      );
      return invalidAdoptionRequestResponse();
    }

    if (!result.ok) {
      warnInvalidProfileBundleRedeemRequest("grant_rejected");
      return invalidAdoptionRequestResponse();
    }

    return jsonResponse(result.bundle);
  }),
});

// GET /api/diffs - list published diffs (optional role filter)
http.route({
  path: "/api/diffs",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const role = url.searchParams.get("role") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : undefined;
    const limit =
      parsedLimit !== undefined && Number.isFinite(parsedLimit)
        ? parsedLimit
        : undefined;

    const diffs = betaAccess.user
      ? await ctx.runQuery(internal.diffs.listForBetaUser, {
          betaUserId: betaAccess.user._id,
          role,
          limit,
        })
      : await ctx.runQuery(api.diffs.list, { role, limit });

    return jsonResponse(diffs);
  }),
});

/*
 * POST /api/adoptions records desktop adoption events.
 *
 * While the beta gate is on, the caller must send an allowlisted CLI session
 * as a Bearer token. BETA_GATE=off restores the legacy anonymous contract.
 * The action caps, parses, and shapes the request before one internalMutation
 * so reads-that-inform-writes and writes remain covered by Convex OCC.
 */
http.route({
  path: "/api/adoptions",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const rawBody = await readCappedRequestText(req, MAX_ADOPTION_BODY_BYTES);
    if (!rawBody.ok) {
      warnInvalidAdoptionRequest(rawBody.reason);
      return invalidAdoptionRequestResponse();
    }

    const parsedBody = parseCappedJsonRequestBody(rawBody.text);
    if (!parsedBody.ok) {
      warnInvalidAdoptionRequest(parsedBody.reason);
      return invalidAdoptionRequestResponse();
    }

    const shaped = shapeAdoptionRequest(parsedBody.body);
    if (!shaped.ok) {
      warnInvalidAdoptionRequest(shaped.reason);
      return invalidAdoptionRequestResponse();
    }

    let result;
    try {
      result = await ctx.runMutation(
        internal.adoptionEvents.recordFromDesktop,
        {
          ...shaped.value,
          betaUserId: betaAccess.user?._id,
        }
      );
    } catch (error) {
      warnInvalidAdoptionRequest(
        error instanceof Error
          ? `mutation_exception:${error.message}`
          : "mutation_exception"
      );
      return invalidAdoptionRequestResponse();
    }

    if (!result.ok) {
      warnInvalidAdoptionRequest(result.reason);
      return invalidAdoptionRequestResponse();
    }

    return jsonResponse({ ok: true, recorded: result.recorded });
  }),
});

// POST /api/connect/redeem - exchange a connection code for user info
// Used by the CLI after user pastes their code
http.route({
  path: "/api/connect/redeem",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    // Get IP from headers
    const ip = req.headers.get("x-forwarded-for") || "unknown";

    const body = await req.json();
    const code = body?.code;

    if (!code || typeof code !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing code" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const redemption = await redeemCodeForHttp(ctx, code, ip);
    if (redemption.error) return redemption.error;
    const result = redemption.result!;

    if ("error" in result) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { userId: _userId, ...publicResult } = result;
    return jsonResponse(publicResult);
  }),
});

// POST /api/review/create - Create review session
http.route({
  path: "/api/review/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.json();
    const { sessionToken, diffs } = body ?? {};

    if (!sessionToken || !diffs) {
      return new Response(
        JSON.stringify({ error: "Missing sessionToken or diffs" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let result;
    try {
      result = await ctx.runMutation(api.review.createSession, {
        sessionToken,
        diffs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create review session";
      if (message.includes("not in the DexDiff beta")) {
        return betaDeniedResponse();
      }
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
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const session = url.searchParams.get("session");

    if (!session) {
      return new Response(
        JSON.stringify({ error: "Missing session parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = betaAccess.user
      ? await ctx.runQuery(internal.review.checkPublishedForUser, {
          userId: betaAccess.user._id,
          sessionCode: session,
        })
      : await ctx.runQuery(api.review.checkPublished, {
          sessionCode: session,
        });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-cli",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createCliSession, {
      ...parseHarnessUserFields(body),
      expired: body?.expired === true,
    });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-connect-code",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createConnectionCode, {
      ...parseHarnessUserFields(body),
      expired: body?.expired === true,
      redeemed: body?.redeemed === true,
    });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-review",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createReviewSession, {
      ...parseHarnessUserFields(body),
      expired: body?.expired === true,
      diffs: Array.isArray(body?.diffs) ? body.diffs : undefined,
    });

    return jsonResponse({
      ...result,
      reviewUrl: `/diff/review/?session=${result.sessionCode}`,
    });
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-public-profile",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const result = await ctx.runMutation(internal.testHarness.createPublicProfileBundle, {
      ...parseHarnessUserFields(body),
      loveLetter: typeof body?.loveLetter === "string" ? body.loveLetter : undefined,
      diffs: Array.isArray(body?.diffs) ? body.diffs : undefined,
    });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-auth",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    const user = await ctx.runMutation(internal.testHarness.createAuthUser, {
      ...parseHarnessUserFields(body),
    });
    const session = await ctx.runMutation(internal.auth.store, {
      args: {
        type: "signIn",
        userId: user.userId,
        generateTokens: true,
      },
    });

    if (!session.tokens) {
      return jsonResponse({ error: "Unable to create auth tokens" }, 500);
    }

    return jsonResponse({
      handle: user.handle,
      email: user.email,
      domain: user.domain,
      token: session.tokens.token,
      refreshToken: session.tokens.refreshToken,
    });
  }),
});

registerTestRoute({
  path: "/api/test/bootstrap-company-domain",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    if (typeof body?.domain !== "string" || !Array.isArray(body?.members)) {
      return jsonResponse({ error: "domain and members are required" }, 400);
    }

    const result = await ctx.runMutation(internal.testHarness.createCompanyDomain, {
      domain: body.domain,
      company: typeof body?.company === "string" ? body.company : undefined,
      members: body.members.map(parseHarnessCompanyMember),
    });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/company",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const url = new URL(req.url);
    const handle = url.searchParams.get("handle");
    if (!handle) {
      return jsonResponse({ error: "handle is required" }, 400);
    }

    const result = await ctx.runQuery(internal.testHarness.getCompanyForHandle, {
      handle: normalizeHandleParam(handle),
    });
    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/diffs",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const url = new URL(req.url);
    const handle = url.searchParams.get("handle");
    if (!handle) {
      return jsonResponse({ error: "handle is required" }, 400);
    }

    const result = await ctx.runQuery(internal.testHarness.getPublishedDiffsForHandle, {
      handle: normalizeHandleParam(handle),
    });
    return jsonResponse(result);
  }),
});

registerTestRoute({
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

registerTestRoute({
  path: "/api/test/bootstrap-adopt-grant",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) {
      return authError;
    }

    const body = await req.json();
    if (typeof body?.targetHandle !== "string") {
      return jsonResponse({ error: "targetHandle is required" }, 400);
    }

    const result = await ctx.runMutation(internal.testHarness.createAdoptGrant, {
      targetHandle: normalizeHandleParam(body.targetHandle),
      granterHandle:
        typeof body?.granterHandle === "string"
          ? normalizeHandleParam(body.granterHandle)
          : undefined,
      expired: body?.expired === true,
      redeemed: body?.redeemed === true,
    });

    return jsonResponse(result);
  }),
});

registerTestRoute({
  path: "/api/test/set-beta-email",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) return authError;

    const body = await req.json();
    if (typeof body?.email !== "string" || typeof body?.allowed !== "boolean") {
      return jsonResponse({ error: "email and allowed are required" }, 400);
    }
    return jsonResponse(
      await ctx.runMutation(internal.beta.setEmailForTest, {
        email: body.email,
        allowed: body.allowed,
      }),
    );
  }),
});

registerTestRoute({
  path: "/api/test/remove-beta-email",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const authError = authorizeTestHarness(req);
    if (authError) return authError;

    const body = await req.json();
    if (typeof body?.email !== "string") {
      return jsonResponse({ error: "email is required" }, 400);
    }
    return jsonResponse(
      await ctx.runMutation(internal.beta.removeEmailForTest, {
        email: body.email,
      }),
    );
  }),
});

// POST /api/publish - publish a diff, authenticated via connection code
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
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const redemption = await redeemCodeForHttp(ctx, code, ip);
    if (redemption.error) return redemption.error;
    const authResult = redemption.result!;

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
    const result = await ctx.runMutation(internal.diffs.publishViaCode, {
      userId: authResult.userId,
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

// POST /api/love-letter - submit a love letter, authenticated via connection code
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
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const redemption = await redeemCodeForHttp(ctx, code, ip);
    if (redemption.error) return redemption.error;
    const authResult = redemption.result!;

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

    const result = await ctx.runMutation(internal.loveLetters.submit, {
      userId: authResult.userId,
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

// GET /api/love-letters - public list of published love letters with optional filters
http.route({
  path: "/api/love-letters",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const betaAccess = await resolveHttpBetaUser(ctx, req);
    if (betaAccess.error) return betaAccess.error;
    const url = new URL(req.url);
    const function_ = url.searchParams.get("function") ?? undefined;
    const seniority = url.searchParams.get("seniority") ?? undefined;
    const diffSlug = url.searchParams.get("diffSlug") ?? undefined;
    const rawHandle = url.searchParams.get("handle") ?? undefined;
    const handle = rawHandle ? normalizeHandleParam(rawHandle) : undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    const queryArgs = { function_, seniority, diffSlug, handle, limit };
    const letters = betaAccess.user
      ? await ctx.runQuery(internal.loveLetters.listForBetaUser, {
          betaUserId: betaAccess.user._id,
          ...queryArgs,
        })
      : await ctx.runQuery(api.loveLetters.list, queryArgs);

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
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  path: "/api/adoptions",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

http.route({
  path: "/api/profile-bundle/redeem",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

registerTestRoute({
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

registerTestRoute({
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

registerTestRoute({
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

registerTestRoute({
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

registerTestRoute({
  path: "/api/test/bootstrap-adopt-grant",
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

registerTestRoute({
  path: "/api/test/remove-beta-email",
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

// POST /api/waitlist - email capture for the QR funnel page (/diff/like-dave/)
http.route({
  path: "/api/waitlist",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!checkRateLimit(ip)) {
      return jsonResponse({ error: "Too many requests - try again in a minute" }, 429);
    }

    let body: { email?: unknown; source?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
      return jsonResponse({ error: "Please enter a valid email address" }, 400);
    }

    const source =
      typeof body.source === "string" ? body.source.slice(0, 100) : undefined;

    const result = await ctx.runMutation(internal.waitlist.join, { email, source });
    return jsonResponse(result);
  }),
});

http.route({
  path: "/api/waitlist",
  method: "OPTIONS",
  handler: corsPreflightHandler,
});

export default http;
