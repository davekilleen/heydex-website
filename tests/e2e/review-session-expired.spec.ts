import { expect, test } from "@playwright/test";
import { bootstrapReviewSession } from "./support/testApi";

test("expired review sessions show a recovery path", async ({ page, request }) => {
  const seeded = await bootstrapReviewSession(request, {
    handle: `e2e-expired-${Date.now()}`,
    expired: true,
  });

  await page.goto(`/diff/review/?session=${seeded.sessionCode}`);

  await expect(page.getByRole("heading", { name: "This review link expired." })).toBeVisible();
  await expect(
    page.getByText("Return to Dex and reopen the same saved draft to mint a fresh review link.")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Go to your profile/i })).toBeVisible();
});
