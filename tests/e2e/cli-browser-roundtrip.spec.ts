import { expect, test } from "@playwright/test";
import {
  bootstrapConnectionCode,
  createReviewSessionViaApi,
  getReviewSession,
  getReviewStatus,
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
  await page.getByRole("button", { name: /Publish publicly/i }).click();

  await page.waitForURL(new RegExp(`/diff/@${handle}/?$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "CLI Roundtrip Published" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Roundtrip Workflow Published" })
  ).toBeVisible();
});
