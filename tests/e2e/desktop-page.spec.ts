import { expect, test } from "@playwright/test";

test("desktop page exposes help navigation and a native feedback walkthrough", async ({ page }) => {
  await page.goto("/desktop/");

  await expect(page.getByRole("navigation", {
    name: "Desktop help and page navigation",
  })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the help center" })
  ).toHaveAttribute("href", "/desktop/help/");

  const feedbackLoop = page.getByRole("list", { name: "Feedback loop" });
  await expect(feedbackLoop.getByRole("listitem")).toHaveCount(4);

  const walkthrough = page.getByRole("list", {
    name: "Desktop feedback walkthrough",
  });
  await expect(walkthrough.getByRole("listitem")).toHaveCount(4);
  await expect(walkthrough.locator("img")).toHaveCount(4);
  await expect(walkthrough.getByRole("button")).toHaveCount(0);
});

test("desktop help stays available while a narrow viewport scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.goto("/desktop/");

  const helpLink = page.getByRole("link", { name: "Open the help center" });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));

  await expect(helpLink).toBeInViewport();
});
