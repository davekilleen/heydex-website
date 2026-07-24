import { expect, test } from "@playwright/test";
import {
  bootstrapAdoptGrant,
  bootstrapAuthState,
  bootstrapCliSession,
  bootstrapCompanyDomain,
  bootstrapPublicProfile,
  generateAdoptGrantAsUser,
  redeemProfileBundleGrant,
} from "./support/testApi";

const INVALID_REQUEST_BODY = {
  error: "invalid_request",
  code: "INVALID_REQUEST",
};

function uniqueHandle(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function uniqueDomain(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}.example`;
}

function buildDiff(diffId: string, name: string) {
  return {
    diffId,
    name,
    description: `${name} adopt bridge fixture.`,
    methodology:
      `dexdiff_schema: "2.0"\nname: ${name}\nproblem: Private bundles need a grant.\nsolution: Redeem a short lived bridge grant.`,
    tags: ["adopt-bridge"],
    roles: ["Product"],
    integrations: ["calendar"],
  };
}

async function expectUniformInvalidRequest(
  response: Awaited<ReturnType<typeof redeemProfileBundleGrant>>
) {
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual(INVALID_REQUEST_BODY);
}

test("authorized colleague grant redeems into a full profile bundle", async ({
  request,
}) => {
  const domain = uniqueDomain("adopt-bridge-colleague");
  const viewerHandle = uniqueHandle("bridge-viewer");
  const targetHandle = uniqueHandle("bridge-target");
  const diff = buildDiff("colleague-operating-rhythm", "Colleague Operating Rhythm");

  await bootstrapCompanyDomain(request, {
    domain,
    company: "Bridge Systems",
    members: [
      {
        handle: viewerHandle,
        displayName: "Bridge Viewer",
        visibility: "colleagues",
      },
      {
        handle: targetHandle,
        displayName: "Bridge Target",
        visibility: "colleagues",
        diffs: [diff],
      },
    ],
  });

  const viewerAuth = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@${domain}`,
    displayName: "Bridge Viewer",
    visibility: "colleagues",
  });

  const grant = await generateAdoptGrantAsUser(request, viewerAuth, targetHandle);
  expect(grant).toMatchObject({
    expiresInSeconds: 600,
  });
  expect(grant.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);

  const response = await redeemProfileBundleGrant(request, {
    code: grant.code,
    handle: targetHandle,
    sessionToken: grant.sessionToken,
  });
  await expect(response).toBeOK();

  const bundle = await response.json();
  expect(bundle.contractVersion).toBe("2026-04-10");
  expect(bundle.profile.handle).toBe(targetHandle);
  expect(bundle.profile.visibility).toBe("colleagues");
  expect(bundle.workflows).toEqual([
    expect.objectContaining({
      diffId: diff.diffId,
      methodology: expect.stringContaining("Private bundles need a grant"),
    }),
  ]);
});

test("non-colleague viewer cannot mint a colleagues-only grant", async ({
  request,
}) => {
  const targetDomain = uniqueDomain("adopt-bridge-target");
  const viewerDomain = uniqueDomain("adopt-bridge-outsider");
  const targetHandle = uniqueHandle("bridge-private-target");
  const viewerHandle = uniqueHandle("bridge-outsider");

  await bootstrapCompanyDomain(request, {
    domain: targetDomain,
    company: "Target Systems",
    members: [
      {
        handle: targetHandle,
        displayName: "Private Target",
        visibility: "colleagues",
        diffs: [buildDiff("target-only-workflow", "Target Only Workflow")],
      },
    ],
  });

  const outsiderAuth = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@${viewerDomain}`,
    displayName: "Outside Viewer",
    visibility: "colleagues",
  });

  await expect(
    generateAdoptGrantAsUser(request, outsiderAuth, targetHandle)
  ).rejects.toThrow(/NOT_AUTHORIZED/);
});

test("redeeming the same grant twice returns a uniform 400 on the second use", async ({
  request,
}) => {
  const viewerHandle = uniqueHandle("bridge-public-viewer");
  const targetHandle = uniqueHandle("bridge-public-target");

  await bootstrapPublicProfile(request, {
    handle: targetHandle,
    displayName: "Single Use Target",
    visibility: "public",
    diffs: [buildDiff("single-use-workflow", "Single Use Workflow")],
  });
  const viewerAuth = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@single-use.example`,
    displayName: "Single Use Viewer",
    visibility: "private",
  });

  const grant = await generateAdoptGrantAsUser(request, viewerAuth, targetHandle);
  await expect(
    await redeemProfileBundleGrant(request, {
      code: grant.code,
      handle: targetHandle,
      sessionToken: grant.sessionToken,
    })
  ).toBeOK();

  await expectUniformInvalidRequest(
    await redeemProfileBundleGrant(request, {
      code: grant.code,
      handle: targetHandle,
      sessionToken: grant.sessionToken,
    })
  );
});

test("expired grants return the uniform 400 redeem response", async ({
  request,
}) => {
  const targetHandle = uniqueHandle("bridge-expired-target");
  await bootstrapPublicProfile(request, {
    handle: targetHandle,
    displayName: "Expired Grant Target",
    visibility: "public",
    diffs: [buildDiff("expired-workflow", "Expired Workflow")],
  });

  const grant = await bootstrapAdoptGrant(request, {
    targetHandle,
    expired: true,
  });
  const granterCli = await bootstrapCliSession(request, {
    handle: grant.granterHandle,
    betaAllowed: true,
  });

  await expectUniformInvalidRequest(
    await redeemProfileBundleGrant(request, {
      code: grant.code,
      handle: targetHandle,
      sessionToken: granterCli.sessionToken,
    })
  );
});

test("grant for one handle cannot fetch another handle", async ({ request }) => {
  const viewerHandle = uniqueHandle("bridge-scope-viewer");
  const handleA = uniqueHandle("bridge-scope-a");
  const handleB = uniqueHandle("bridge-scope-b");

  await bootstrapPublicProfile(request, {
    handle: handleA,
    displayName: "Scoped Target A",
    visibility: "public",
    diffs: [buildDiff("scoped-a-workflow", "Scoped A Workflow")],
  });
  await bootstrapPublicProfile(request, {
    handle: handleB,
    displayName: "Scoped Target B",
    visibility: "public",
    diffs: [buildDiff("scoped-b-workflow", "Scoped B Workflow")],
  });
  const viewerAuth = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@scope.example`,
    displayName: "Scoped Viewer",
    visibility: "private",
  });

  const grant = await generateAdoptGrantAsUser(request, viewerAuth, handleA);

  await expectUniformInvalidRequest(
    await redeemProfileBundleGrant(request, {
      code: grant.code,
      handle: handleB,
      sessionToken: grant.sessionToken,
    })
  );
});

test("owners can mint for themselves and any signed-in viewer can mint for public targets", async ({
  request,
}) => {
  const ownerHandle = uniqueHandle("bridge-owner");
  const ownerEmail = `${ownerHandle}@owner.example`;
  const publicHandle = uniqueHandle("bridge-any-public");

  await bootstrapPublicProfile(request, {
    handle: ownerHandle,
    email: ownerEmail,
    displayName: "Owner Target",
    visibility: "private",
    diffs: [buildDiff("owner-workflow", "Owner Workflow")],
  });
  await bootstrapPublicProfile(request, {
    handle: publicHandle,
    displayName: "Any Viewer Public Target",
    visibility: "public",
    diffs: [buildDiff("public-workflow", "Public Workflow")],
  });

  const ownerAuth = await bootstrapAuthState(request, {
    handle: ownerHandle,
    email: ownerEmail,
    displayName: "Owner Target",
    visibility: "private",
  });
  const anyViewerAuth = await bootstrapAuthState(request, {
    handle: uniqueHandle("bridge-any-viewer"),
    email: `any-viewer-${Date.now()}@public.example`,
    displayName: "Any Public Viewer",
    visibility: "private",
  });

  const ownerGrant = await generateAdoptGrantAsUser(
    request,
    ownerAuth,
    ownerHandle
  );
  expect(ownerGrant.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);

  const publicGrant = await generateAdoptGrantAsUser(
    request,
    anyViewerAuth,
    publicHandle
  );
  expect(publicGrant.code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
});
