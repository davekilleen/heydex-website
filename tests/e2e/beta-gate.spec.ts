import { expect, test } from "@playwright/test";
import {
  apiUrl,
  bootstrapAuthState,
  bootstrapCliSession,
  bootstrapConnectionCode,
  bootstrapPublicProfile,
  createReviewSessionViaApi,
  getAnonymousConvexClient,
  getAuthenticatedConvexClient,
  removeBetaEmail,
} from "./support/testApi";

test.skip(
  process.env.E2E_BETA_GATE !== "1",
  "Private-beta enforcement runs only against the dedicated test deployment with BETA_GATE on.",
);

const DIFF = {
  diffId: "beta-boundary",
  name: "Beta Boundary",
  description: "Security-boundary fixture.",
  methodology: "Problem:\nLeaks.\n\nSolution:\nDeny outside the allowlist.",
  tags: ["security"],
  roles: ["Product"],
  integrations: [],
};

async function expectDenied(operation: Promise<unknown>) {
  await expect(operation).rejects.toThrow(/beta|authenticated|authorized/i);
}

test("direct Convex reads allow the cohort and deny non-members and anonymous callers", async ({
  request,
}) => {
  const stamp = Date.now();
  const target = await bootstrapPublicProfile(request, {
    handle: `beta-target-${stamp}`,
    email: `beta-target-${stamp}@acme.test`,
    betaAllowed: true,
    diffs: [DIFF],
    loveLetter: "Private beta fixture.",
  });
  const allowed = await bootstrapAuthState(request, {
    handle: `beta-allowed-${stamp}`,
    email: `beta-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const denied = await bootstrapAuthState(request, {
    handle: `beta-denied-${stamp}`,
    email: `beta-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });

  const allowedClient = getAuthenticatedConvexClient(allowed);
  const deniedClient = getAuthenticatedConvexClient(denied);
  const anonymousClient = getAnonymousConvexClient();
  const reads: Array<[string, Record<string, unknown>]> = [
    ["diffs:get", { authorHandle: target.handle, diffId: DIFF.diffId }],
    ["diffs:list", {}],
    ["diffs:listByAuthor", { authorHandle: target.handle }],
    ["profiles:get", { handle: target.handle }],
    ["profiles:getBundle", { handle: target.handle }],
    ["loveLetters:list", { handle: target.handle }],
    ["adoptions:mine", {}],
    ["users:me", {}],
    ["users:viewerState", {}],
    ["companies:myCompany", {}],
  ];

  for (const [name, args] of reads) {
    await expect(allowedClient.query(name, args)).resolves.not.toBeUndefined();
    await expectDenied(deniedClient.query(name, args));
    await expectDenied(anonymousClient.query(name, args));
  }

  await expect(deniedClient.query("beta:viewerAccess", {})).resolves.toEqual({
    authenticated: true,
    allowed: false,
  });
});

test("direct Convex write chokepoints deny non-members and anonymous callers", async ({
  request,
}) => {
  const stamp = Date.now();
  const target = await bootstrapPublicProfile(request, {
    handle: `beta-write-target-${stamp}`,
    email: `beta-write-target-${stamp}@acme.test`,
    betaAllowed: true,
    diffs: [DIFF],
  });
  const allowed = await bootstrapAuthState(request, {
    handle: `beta-write-allowed-${stamp}`,
    email: `beta-write-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const denied = await bootstrapAuthState(request, {
    handle: `beta-write-denied-${stamp}`,
    email: `beta-write-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  const allowedClient = getAuthenticatedConvexClient(allowed);
  const deniedClient = getAuthenticatedConvexClient(denied);
  const anonymousClient = getAnonymousConvexClient();

  const writes: Array<[string, Record<string, unknown>]> = [
    ["connect:generateCode", {}],
    [
      "users:register",
      { displayName: "Allowed", handle: allowed.handle },
    ],
    ["users:setVisibility", { visibility: "private" }],
    ["users:togglePublic", { isPublic: false }],
    [
      "diffs:publish",
      {
        ...DIFF,
        diffId: `allowed-publish-${stamp}`,
        description: DIFF.description,
      },
    ],
    [
      "adoptions:record",
      { authorHandle: target.handle, diffSlug: DIFF.diffId },
    ],
    ["adopt:generateGrant", { targetHandle: target.handle }],
    ["review:createLoveLetterSession", {}],
  ];

  for (const [name, args] of writes) {
    await expect(allowedClient.mutation(name, args)).resolves.not.toBeUndefined();
    await expectDenied(deniedClient.mutation(name, args));
    await expectDenied(anonymousClient.mutation(name, args));
  }

  await expectDenied(
    anonymousClient.mutation("review:publishFromSession", {
      sessionCode: "ABCDEFGH",
    }),
  );
  await expect(
    allowedClient.mutation("diffs:publishViaCode", {
      userId: "forged",
      ...DIFF,
    }),
  ).rejects.toThrow(/public function|not found/i);

  const allowedCode = await bootstrapConnectionCode(request, {
    handle: `beta-direct-code-allowed-${stamp}`,
    email: `beta-direct-code-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const deniedCode = await bootstrapConnectionCode(request, {
    handle: `beta-direct-code-denied-${stamp}`,
    email: `beta-direct-code-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  await expect(
    anonymousClient.mutation("connect:redeemCode", { code: allowedCode.code }),
  ).resolves.toMatchObject({ sessionToken: expect.any(String) });
  await expectDenied(
    anonymousClient.mutation("connect:redeemCode", { code: deniedCode.code }),
  );

  const allowedCli = await bootstrapCliSession(request, {
    handle: `beta-direct-review-allowed-${stamp}`,
    email: `beta-direct-review-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const deniedCli = await bootstrapCliSession(request, {
    handle: `beta-direct-review-denied-${stamp}`,
    email: `beta-direct-review-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  await expect(
    anonymousClient.mutation("review:createSession", {
      sessionToken: allowedCli.sessionToken,
      diffs: [DIFF],
    }),
  ).resolves.toMatchObject({ sessionCode: expect.any(String) });
  await expectDenied(
    anonymousClient.mutation("review:createSession", {
      sessionToken: deniedCli.sessionToken,
      diffs: [DIFF],
    }),
  );
  await expectDenied(
    anonymousClient.mutation("review:createSession", {
      sessionToken: "not-a-session",
      diffs: [DIFF],
    }),
  );
});

test("HTTP and direct-host content routes require an allowlisted CLI session", async ({
  request,
}) => {
  const stamp = Date.now();
  const target = await bootstrapPublicProfile(request, {
    handle: `beta-api-target-${stamp}`,
    email: `beta-api-target-${stamp}@acme.test`,
    betaAllowed: true,
    diffs: [DIFF],
    loveLetter: "HTTP beta fixture.",
  });
  const allowed = await bootstrapCliSession(request, {
    handle: `beta-api-allowed-${stamp}`,
    email: `beta-api-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const denied = await bootstrapCliSession(request, {
    handle: `beta-api-denied-${stamp}`,
    email: `beta-api-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  const paths = [
    `/diff?author=${target.handle}&id=${DIFF.diffId}`,
    `/profile?handle=${target.handle}`,
    `/profile-bundle?handle=${target.handle}`,
    "/diffs",
    "/love-letters",
  ];

  for (const path of paths) {
    const allowedResponse = await request.get(apiUrl(path), {
      headers: { authorization: `Bearer ${allowed.sessionToken}` },
    });
    expect(allowedResponse.ok(), `${path} should allow cohort session`).toBe(true);

    const deniedResponse = await request.get(apiUrl(path), {
      headers: { authorization: `Bearer ${denied.sessionToken}` },
    });
    expect(deniedResponse.status(), `${path} should deny non-member`).toBe(403);

    const anonymousResponse = await request.get(apiUrl(path));
    expect(anonymousResponse.status(), `${path} should deny anonymous`).toBe(401);
  }
});

test("code, review, publish, and removal paths re-check membership at use time", async ({
  request,
}) => {
  const stamp = Date.now();
  const allowedEmail = `beta-session-allowed-${stamp}@acme.test`;
  const allowedHandle = `beta-session-allowed-${stamp}`;
  const deniedEmail = `beta-session-denied-${stamp}@acme.test`;
  const allowedCode = await bootstrapConnectionCode(request, {
    handle: allowedHandle,
    email: allowedEmail,
    betaAllowed: true,
  });
  const deniedCode = await bootstrapConnectionCode(request, {
    handle: `beta-session-denied-${stamp}`,
    email: deniedEmail,
    betaAllowed: false,
  });

  const allowedRedeem = await request.post(apiUrl("/connect/redeem"), {
    data: { code: allowedCode.code },
  });
  expect(allowedRedeem.ok()).toBe(true);
  const allowedSession = await allowedRedeem.json();

  const deniedRedeem = await request.post(apiUrl("/connect/redeem"), {
    data: { code: deniedCode.code },
  });
  expect(deniedRedeem.status()).toBe(403);

  const deniedCli = await bootstrapCliSession(request, {
    handle: `beta-review-denied-${stamp}`,
    email: `beta-review-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  const deniedCreate = await request.post(apiUrl("/review/create"), {
    data: { sessionToken: deniedCli.sessionToken, diffs: [DIFF] },
  });
  expect(deniedCreate.status()).toBe(403);

  const publishAllowedCode = await bootstrapConnectionCode(request, {
    handle: `beta-publish-allowed-${stamp}`,
    email: `beta-publish-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const publishDeniedCode = await bootstrapConnectionCode(request, {
    handle: `beta-publish-denied-${stamp}`,
    email: `beta-publish-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  const publishBody = { code: publishAllowedCode.code, ...DIFF };
  expect(
    (
      await request.post(apiUrl("/publish"), {
        data: publishBody,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(apiUrl("/publish"), {
        data: { ...publishBody, code: publishDeniedCode.code },
      })
    ).status(),
  ).toBe(403);

  const adoptionTarget = await bootstrapPublicProfile(request, {
    handle: `beta-adoption-target-${stamp}`,
    email: `beta-adoption-target-${stamp}@acme.test`,
    betaAllowed: true,
    diffs: [DIFF],
  });
  const adoptionBody = {
    authorHandle: adoptionTarget.handle,
    diffIds: [DIFF.diffId],
    source: `beta-e2e-${stamp}`,
    contractVersion: "2026-04-10",
  };
  expect(
    (
      await request.post(apiUrl("/adoptions"), {
        headers: { authorization: `Bearer ${allowedSession.sessionToken}` },
        data: adoptionBody,
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(apiUrl("/adoptions"), {
        headers: { authorization: `Bearer ${deniedCli.sessionToken}` },
        data: adoptionBody,
      })
    ).status(),
  ).toBe(403);
  expect((await request.post(apiUrl("/adoptions"), { data: adoptionBody })).status()).toBe(401);

  const created = await createReviewSessionViaApi(request, {
    sessionToken: allowedSession.sessionToken,
    diffs: [DIFF],
  });
  const allowedAuth = await bootstrapAuthState(request, {
    handle: allowedHandle,
    email: allowedEmail,
    betaAllowed: true,
  });
  const allowedClient = getAuthenticatedConvexClient(allowedAuth);
  const grantTarget = await bootstrapPublicProfile(request, {
    handle: `beta-grant-target-${stamp}`,
    email: `beta-grant-target-${stamp}@acme.test`,
    betaAllowed: true,
    diffs: [DIFF],
  });
  const grant = await allowedClient.mutation("adopt:generateGrant", {
    targetHandle: grantTarget.handle,
  });
  const redeemedBundle = await request.post(apiUrl("/profile-bundle/redeem"), {
    data: { code: grant.code, handle: grantTarget.handle },
  });
  expect(redeemedBundle.ok()).toBe(true);

  await expect(
    allowedClient.mutation("review:publishFromSession", {
      sessionCode: created.sessionCode,
    }),
  ).resolves.toMatchObject({ success: true });

  const loveAllowedCode = await bootstrapConnectionCode(request, {
    handle: `beta-love-allowed-${stamp}`,
    email: `beta-love-allowed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const loveDeniedCode = await bootstrapConnectionCode(request, {
    handle: `beta-love-denied-${stamp}`,
    email: `beta-love-denied-${stamp}@acme.test`,
    betaAllowed: false,
  });
  expect(
    (
      await request.post(apiUrl("/love-letter"), {
        data: { code: loveAllowedCode.code, text: "Allowed beta love letter." },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(apiUrl("/love-letter"), {
        data: { code: loveDeniedCode.code, text: "Denied." },
      })
    ).status(),
  ).toBe(403);

  const liveSession = await bootstrapCliSession(request, {
    handle: `beta-removed-${stamp}`,
    email: `beta-removed-${stamp}@acme.test`,
    betaAllowed: true,
  });
  const liveReview = await createReviewSessionViaApi(request, {
    sessionToken: liveSession.sessionToken,
    diffs: [DIFF],
  });
  const removal = await removeBetaEmail(request, `beta-removed-${stamp}@acme.test`);
  expect(removal.invalidatedCliSessions).toBeGreaterThan(0);
  expect(removal.invalidatedReviewSessions).toBeGreaterThan(0);

  const afterRemoval = await request.get(
    apiUrl(`/review/status?session=${liveReview.sessionCode}`),
    { headers: { authorization: `Bearer ${liveSession.sessionToken}` } },
  );
  expect([401, 403]).toContain(afterRemoval.status());
});
