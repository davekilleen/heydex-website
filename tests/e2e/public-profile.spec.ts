import { expect, test } from "@playwright/test";
import { bootstrapPublicProfile } from "./support/testApi";

test("public profile shows profile-level and workflow-level adoption commands", async ({ page, request }) => {
  const handle = `public-${Date.now()}`;
  await bootstrapPublicProfile(request, {
    handle,
    displayName: "Public Profile Test",
    title: "Field CPO",
    company: "Pendo",
    summary: "Public profile contract fixture.",
    loveLetter: "Dex gave me a calmer system for real work.",
    diffs: [
      {
        diffId: "meeting-prep",
        name: "Meeting Prep",
        description: "Pull context together before important meetings.",
        methodology:
          "dexdiff_schema: \"2.0\"\nname: Meeting Prep\nproblem: Context is fragmented.\nsolution: Assemble it before the meeting.",
        tags: ["meetings", "prep"],
        roles: ["Executive"],
        integrations: ["calendar", "gmail"],
      },
    ],
  });

  await page.goto(`/diff/@${handle}/`);

  await expect(page.getByRole("heading", { name: "Public Profile Test" })).toBeVisible();
  await expect(page.getByText(`/diff-adopt-profile @${handle}`)).toBeVisible();
  await expect(page.getByText(`/diff-adopt @${handle}/meeting-prep`)).toBeVisible();
  await expect(page.locator(".public-profile-command-label", { hasText: "Whole profile" })).toBeVisible();
  await expect(page.locator(".public-profile-command-label", { hasText: "One workflow" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register to copy" })).toHaveCount(2);
});
