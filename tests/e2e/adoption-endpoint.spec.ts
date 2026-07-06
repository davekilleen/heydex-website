import { APIRequestContext, expect, test } from "@playwright/test";
import { getEnv } from "./support/env";

const CONTRACT_VERSION = "2026-04-10";
const SOURCE = "dex-desktop-concierge/dexdiff-mcp";
const INVALID_REQUEST_BODY = {
  error: "invalid_request",
  code: "INVALID_REQUEST",
};

type DiffSeed = {
  diffId: string;
  name: string;
  description: string;
  methodology: string;
  tags: string[];
  roles: string[];
  integrations: string[];
};

type ProfileBundle = {
  profile: {
    handle: string;
    totalAdoptions: number;
  };
  workflows: Array<{
    diffId: string;
    adoptionCount: number;
  }>;
};

function apiBaseUrl() {
  return getEnv("E2E_API_BASE_URL").replace(/\/$/, "");
}

function testHarnessHeaders() {
  return {
    "content-type": "application/json",
    "x-heydex-test-secret": getEnv("E2E_TEST_SECRET"),
  };
}

function uniqueHandle(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function buildDiff(diffId: string, name: string): DiffSeed {
  return {
    diffId,
    name,
    description: `${name} adoption endpoint fixture.`,
    methodology: `dexdiff_schema: "2.0"\nname: ${name}\nproblem: Counts need to move.\nsolution: Record valid desktop adoptions.`,
    tags: ["adoption-endpoint"],
    roles: ["Product"],
    integrations: ["calendar"],
  };
}

async function seedPublishedProfile(
  request: APIRequestContext,
  handle: string,
  diffs: DiffSeed[]
) {
  const response = await request.post(`${apiBaseUrl()}/test/bootstrap-public-profile`, {
    headers: testHarnessHeaders(),
    data: {
      handle,
      displayName: "Adoption Endpoint Author",
      visibility: "public",
      diffs,
    },
  });
  await expect(response).toBeOK();
}

async function getProfileBundle(request: APIRequestContext, handle: string) {
  const response = await request.get(
    `${apiBaseUrl()}/profile-bundle?handle=${encodeURIComponent(handle)}`
  );
  await expect(response).toBeOK();
  return (await response.json()) as ProfileBundle;
}

function adoptionCount(bundle: ProfileBundle, diffId: string) {
  const workflow = bundle.workflows.find((item) => item.diffId === diffId);
  expect(workflow).toBeTruthy();
  return workflow!.adoptionCount;
}

async function postAdoptions(
  request: APIRequestContext,
  body: {
    authorHandle: string;
    profileHandle?: string;
    diffIds: string[];
    source?: string;
    contractVersion?: string;
  }
) {
  return await request.post(`${apiBaseUrl()}/adoptions`, {
    headers: {
      "content-type": "application/json",
    },
    data: {
      profileHandle: body.profileHandle ?? body.authorHandle,
      source: body.source ?? SOURCE,
      contractVersion: body.contractVersion ?? CONTRACT_VERSION,
      ...body,
    },
  });
}

async function expectInvalidRequest(response: Awaited<ReturnType<typeof postAdoptions>>) {
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual(INVALID_REQUEST_BODY);
}

test("POST /api/adoptions records valid desktop adoptions and dedupes replay within the window", async ({
  request,
}) => {
  const handle = uniqueHandle("adopt-api-happy");
  const meetingDiff = buildDiff("meeting-intelligence", "Meeting Intelligence");
  const followupDiff = buildDiff("follow-through", "Follow Through");

  await seedPublishedProfile(request, handle, [meetingDiff, followupDiff]);

  const firstResponse = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: [meetingDiff.diffId, followupDiff.diffId],
  });
  await expect(firstResponse).toBeOK();
  expect(await firstResponse.json()).toEqual({ ok: true, recorded: 2 });

  const afterFirst = await getProfileBundle(request, handle);
  expect(adoptionCount(afterFirst, meetingDiff.diffId)).toBe(1);
  expect(adoptionCount(afterFirst, followupDiff.diffId)).toBe(1);
  expect(afterFirst.profile.totalAdoptions).toBe(2);

  const secondResponse = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: [meetingDiff.diffId, followupDiff.diffId],
  });
  await expect(secondResponse).toBeOK();
  expect(await secondResponse.json()).toEqual({ ok: true, recorded: 0 });

  const afterSecond = await getProfileBundle(request, handle);
  expect(adoptionCount(afterSecond, meetingDiff.diffId)).toBe(1);
  expect(adoptionCount(afterSecond, followupDiff.diffId)).toBe(1);
  expect(afterSecond.profile.totalAdoptions).toBe(2);
});

test("POST /api/adoptions rejects wrong contractVersion with uniform 400 JSON", async ({
  request,
}) => {
  const handle = uniqueHandle("adopt-api-contract");
  const diff = buildDiff("contract-check", "Contract Check");
  await seedPublishedProfile(request, handle, [diff]);

  const response = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: [diff.diffId],
    contractVersion: "2026-04-09",
  });

  await expectInvalidRequest(response);
});

test("POST /api/adoptions rejects unknown authors with uniform 400 JSON", async ({
  request,
}) => {
  const response = await postAdoptions(request, {
    authorHandle: uniqueHandle("missing-author"),
    diffIds: ["meeting-intelligence"],
  });

  await expectInvalidRequest(response);
});

test("POST /api/adoptions rejects one unknown diff without partial count changes", async ({
  request,
}) => {
  const handle = uniqueHandle("adopt-api-all-or-nothing");
  const goodDiff = buildDiff("known-good", "Known Good");
  await seedPublishedProfile(request, handle, [goodDiff]);

  const response = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: [goodDiff.diffId, "guessed-missing-diff"],
  });

  await expectInvalidRequest(response);

  const bundle = await getProfileBundle(request, handle);
  expect(adoptionCount(bundle, goodDiff.diffId)).toBe(0);
  expect(bundle.profile.totalAdoptions).toBe(0);
});

test("POST /api/adoptions rejects more than 50 diffIds with uniform 400 JSON", async ({
  request,
}) => {
  const handle = uniqueHandle("adopt-api-too-many");
  const diff = buildDiff("too-many-anchor", "Too Many Anchor");
  await seedPublishedProfile(request, handle, [diff]);

  const response = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: Array.from({ length: 51 }, (_, index) => `valid-diff-${index}`),
  });

  await expectInvalidRequest(response);
});

test("POST /api/adoptions rejects duplicate diffIds without count changes", async ({
  request,
}) => {
  const handle = uniqueHandle("adopt-api-duplicate");
  const diff = buildDiff("duplicate-check", "Duplicate Check");
  await seedPublishedProfile(request, handle, [diff]);

  const response = await postAdoptions(request, {
    authorHandle: handle,
    diffIds: [diff.diffId, diff.diffId],
  });

  await expectInvalidRequest(response);

  const bundle = await getProfileBundle(request, handle);
  expect(adoptionCount(bundle, diff.diffId)).toBe(0);
  expect(bundle.profile.totalAdoptions).toBe(0);
});

test("POST /api/adoptions rejects bodies over the byte cap with uniform 400 JSON", async ({
  request,
}) => {
  const response = await request.post(`${apiBaseUrl()}/adoptions`, {
    headers: {
      "content-type": "application/json",
    },
    data: {
      authorHandle: uniqueHandle("adopt-api-large"),
      diffIds: ["large-body-anchor"],
      source: SOURCE,
      contractVersion: CONTRACT_VERSION,
      padding: "x".repeat(33 * 1024),
    },
  });

  await expectInvalidRequest(response);
});

// The per-author daily ceiling is enforced in the Convex mutation. This e2e
// suite deliberately does not seed 200 audit rows just to exercise the clamp.
