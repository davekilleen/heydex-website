import { expect, test } from "@playwright/test";
import { bootstrapReviewSession, getReviewSession } from "./support/testApi";

test("review page persists edits and publishes to the public profile", async ({
  page,
  request,
}) => {
  const handle = `e2e-review-${Date.now()}`;
  const seeded = await bootstrapReviewSession(request, {
    handle,
    displayName: "DexDiff Review E2E",
    title: "VP Product",
    company: "Heydex",
    visibility: "private",
  });

  await page.goto(`/diff/review/?session=${seeded.sessionCode}`);
  await expect(page.getByRole("heading", { name: /Dex drafted your Heydex profile/i })).toBeVisible();

  const nameInput = page.locator(".review-inline-name").first();
  await nameInput.fill("DexDiff Review Updated");
  await nameInput.blur();

  const workflowInput = page.locator(".review-inline-workflow-name").first();
  await workflowInput.fill("Executive Meeting Prep Updated");
  await workflowInput.blur();

  await expect
    .poll(async () => {
      const session = await getReviewSession(seeded.sessionCode);
      return {
        name: session.profile?.displayName,
        workflowName: session.diffs?.[0]?.name,
      };
    })
    .toEqual({
      name: "DexDiff Review Updated",
      workflowName: "Executive Meeting Prep Updated",
    });

  await page.reload();
  await expect(page.locator(".review-inline-name").first()).toHaveValue("DexDiff Review Updated");
  await expect(page.locator(".review-inline-workflow-name").first()).toHaveValue(
    "Executive Meeting Prep Updated"
  );

  await page.locator(".review-audience-option").filter({ hasText: "Public" }).click();
  await page.getByRole("button", { name: /Publish publicly/i }).click();

  await page.waitForURL(new RegExp(`/diff/@${handle}/?$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "DexDiff Review Updated" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Executive Meeting Prep Updated" })).toBeVisible();
});
