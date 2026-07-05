import { expect, test } from "@playwright/test";
import {
  bootstrapAdoption,
  bootstrapAuthState,
  bootstrapConnectionCode,
  createReviewSessionViaApi,
  getPublishedDiffsForHandle,
  getReviewSession,
  getReviewStatus,
  publishReviewSession,
  registerAsUser,
  redeemConnectionCode,
} from "./support/testApi";

const ROUNDTRIP_DIFFS = [
  {
    diffId: "cli-browser-roundtrip",
    name: "CLI Browser Roundtrip",
    description: "Exercises the full CLI-authenticated review flow in the browser.",
    methodology:
      "Problem:\nThe CLI and hosted review flow can drift apart.\n\nSolution:\nRedeem a CLI code, create a review session, then publish through the browser.",
    tags: ["cli", "review", "browser"],
    roles: ["Product"],
    integrations: ["calendar", "gmail"],
  },
];

test("CLI link to browser review to publish works end to end", async ({
  page,
  request,
}) => {
  const handle = `roundtrip-${Date.now()}`;
  const codeSeed = await bootstrapConnectionCode(request, {
    handle,
    displayName: "CLI Browser Roundtrip",
    title: "VP Product",
    company: "Heydex",
    summary: "A seeded roundtrip profile for browser publish coverage.",
    visibility: "private",
  });

  const redeemed = await redeemConnectionCode(request, codeSeed.code);
  const created = await createReviewSessionViaApi(request, {
    sessionToken: redeemed.sessionToken,
    diffs: ROUNDTRIP_DIFFS,
  });

  const unpublished = await getReviewStatus(request, created.sessionCode);
  expect(unpublished.published).toBe(false);
  expect(unpublished.handle).toBe(handle);

  await page.goto(`/diff/review/?session=${created.sessionCode}`);
  await expect(
    page.getByRole("heading", { name: /Dex drafted your Heydex profile/i })
  ).toBeVisible();

  await page.locator(".review-inline-name").first().fill("CLI Roundtrip Published");
  await page.locator(".review-inline-name").first().blur();
  await page
    .locator(".review-inline-workflow-name")
    .first()
    .fill("Roundtrip Workflow Published");
  await page.locator(".review-inline-workflow-name").first().blur();

  await expect
    .poll(async () => {
      const session = await getReviewSession(created.sessionCode);
      return {
        name: session.profile?.displayName,
        workflowName: session.diffs?.[0]?.name,
      };
    })
    .toEqual({
      name: "CLI Roundtrip Published",
      workflowName: "Roundtrip Workflow Published",
    });

  await page.reload();
  await expect(page.locator(".review-inline-name").first()).toHaveValue(
    "CLI Roundtrip Published"
  );
  await expect(page.locator(".review-inline-workflow-name").first()).toHaveValue(
    "Roundtrip Workflow Published"
  );

  await page.locator(".review-audience-option").filter({ hasText: "Public" }).click();
  await page.getByRole("button", { name: /Save public setting/i }).click();

  await page.waitForURL(new RegExp(`/diff/${handle}/?$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "CLI Roundtrip Published" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Roundtrip Workflow Published" })
  ).toBeVisible();
});

test("publishing the same diffId twice updates one row and preserves adoption state", async ({
  request,
}) => {
  const now = Date.now();
  const handle = `upsert-${now}`;
  const domain = `upsert-${now}.example`;
  const diffId = "stable-cli-diff";
  const codeSeed = await bootstrapConnectionCode(request, {
    handle,
    email: `${handle}@${domain}`,
    displayName: "CLI Upsert Author",
    title: "VP Product",
    company: "Upsert Systems",
    visibility: "public",
  });
  const redeemed = await redeemConnectionCode(request, codeSeed.code);

  const firstSession = await createReviewSessionViaApi(request, {
    sessionToken: redeemed.sessionToken,
    diffs: [
      {
        diffId,
        name: "Stable CLI Diff",
        description: "First published version.",
        methodology: "First methodology",
        tags: ["cli"],
        roles: ["Product"],
        integrations: ["calendar"],
      },
    ],
  });
  await publishReviewSession(firstSession.sessionCode);

  const adopterEmail = `adopter-${now}@${domain}`;
  await bootstrapAuthState(request, {
    handle: `adopter-${now}`,
    email: adopterEmail,
    displayName: "Upsert Adopter",
    visibility: "private",
  });
  await bootstrapAdoption(request, {
    email: adopterEmail,
    authorHandle: handle,
    diffSlug: diffId,
  });

  const firstRows = await getPublishedDiffsForHandle(request, handle);
  expect(firstRows).toHaveLength(1);
  expect(firstRows[0]).toMatchObject({
    diffId,
    name: "Stable CLI Diff",
    adoptionCount: 1,
    activeUserCount: 1,
  });
  const firstPublishedAt = firstRows[0].publishedAt;
  const firstUpdatedAt = firstRows[0].updatedAt;

  await new Promise((resolve) => setTimeout(resolve, 5));

  const secondSession = await createReviewSessionViaApi(request, {
    sessionToken: redeemed.sessionToken,
    diffs: [
      {
        diffId,
        name: "Stable CLI Diff Edited",
        description: "Second published version.",
        methodology: "Second methodology",
        tags: ["cli", "edited"],
        roles: ["Product"],
        integrations: ["calendar", "gmail"],
      },
    ],
  });
  await publishReviewSession(secondSession.sessionCode);

  const secondRows = await getPublishedDiffsForHandle(request, handle);
  expect(secondRows).toHaveLength(1);
  expect(secondRows[0]).toMatchObject({
    diffId,
    name: "Stable CLI Diff Edited",
    description: "Second published version.",
    methodology: "Second methodology",
    adoptionCount: 1,
    activeUserCount: 1,
  });
  expect(secondRows[0].publishedAt).toBe(firstPublishedAt);
  expect(secondRows[0].updatedAt).toBeGreaterThan(firstUpdatedAt);
});

test("claimed handles are immutable on later registration attempts", async ({
  request,
}) => {
  const handle = `immutable-${Date.now()}`;
  const authState = await bootstrapAuthState(request, {
    handle,
    email: `${handle}@immutable.example`,
    displayName: "Immutable Handle",
    visibility: "private",
  });

  await expect(
    registerAsUser(authState, {
      displayName: "Immutable Handle",
      handle: `${handle}-renamed`,
    })
  ).rejects.toThrow(/HANDLE_IMMUTABLE/);
});
