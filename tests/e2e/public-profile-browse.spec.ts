import { expect, test } from "@playwright/test";
import { bootstrapPublicProfile } from "./support/testApi";

test("public profiles cold-load for other people and expose browse surfaces", async ({
  page,
  request,
}) => {
  const handle = `browse-${Date.now()}`;

  await bootstrapPublicProfile(request, {
    handle,
    displayName: "Browse Test Person",
    title: "VP Product",
    company: "Heydex",
    summary: "A public profile seeded for non-self browse coverage.",
    loveLetter: "Dex made my working system feel more deliberate and much less fragile.",
    diffs: [
      {
        diffId: "browse-meeting-prep",
        name: "Browse Meeting Prep",
        description: "A public workflow for validating cold loads and profile browse.",
        methodology:
          "Problem:\nContext is fragmented.\n\nSolution:\nPull notes, people, and signals together before important meetings.",
        tags: ["meetings", "prep"],
        roles: ["Product"],
        integrations: ["calendar", "gmail"],
      },
      {
        diffId: "browse-follow-through",
        name: "Browse Follow Through",
        description: "A second public workflow so the profile page renders a real list.",
        methodology:
          "Problem:\nFollow-up drifts.\n\nSolution:\nMake next steps visible and easy to revisit.",
        tags: ["follow-up", "accountability"],
        roles: ["Product"],
        integrations: ["tasks", "calendar"],
      },
    ],
  });

  await page.goto(`/diff/@${handle}/`);
  await expect(page.getByRole("heading", { name: "Browse Test Person" })).toBeVisible();
  await expect(page.locator(".public-profile-meta")).toHaveText(`@${handle}`);
  await expect(page.getByRole("heading", { name: "Browse Meeting Prep" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Browse Follow Through" })).toBeVisible();
  await expect(page.getByText(/Dex made my working system feel more deliberate/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /Register to copy/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Get Dex/i })).toBeVisible();
});
