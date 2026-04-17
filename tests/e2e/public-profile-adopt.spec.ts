import { expect, test } from "@playwright/test";
import {
  completeRegistrationIfNeeded,
  getGoogleAuthStatePath,
  googleAuthEnabled,
  googleAuthSkipMessage,
} from "./support/googleAuth";
import { bootstrapAdoption, bootstrapPublicProfile } from "./support/testApi";

const runAuthenticatedPublicProfileCoverage = googleAuthEnabled();
const googleAuthStatePath = getGoogleAuthStatePath();
const GOOGLE_TEST_EMAIL = "davedextest@gmail.com";

test.use({ storageState: googleAuthStatePath });

test("authenticated public profiles expose adopt copy states", async ({
  page,
  request,
}) => {
  test.skip(
    !runAuthenticatedPublicProfileCoverage,
    googleAuthSkipMessage()
  );

  const handle = `adopt-${Date.now()}`;
  const adopterHandle = `adopter${Date.now().toString().slice(-8)}`;
  const adoptedDiffId = "adopt-meeting-prep";
  const unadoptedDiffId = "adopt-follow-through";

  await page.goto("/connect/?return=/diff/profile/");
  await completeRegistrationIfNeeded(page, adopterHandle);

  await bootstrapPublicProfile(request, {
    handle,
    displayName: "Adopt Test Person",
    title: "VP Product",
    company: "Heydex",
    summary: "A public profile seeded for authenticated adopt coverage.",
    loveLetter:
      "Dex makes the system legible enough that I can reuse what works instead of rebuilding it.",
    diffs: [
      {
        diffId: adoptedDiffId,
        name: "Adopt Meeting Prep",
        description: "A workflow the signed-in test user has already adopted.",
        methodology:
          "Problem:\nImportant meeting context is fragmented.\n\nSolution:\nPull relationship context, notes, and signals into one prep layer.",
        tags: ["meetings", "prep"],
        roles: ["Product"],
        integrations: ["calendar", "gmail"],
      },
      {
        diffId: unadoptedDiffId,
        name: "Adopt Follow Through",
        description: "A second workflow that should still be copyable.",
        methodology:
          "Problem:\nFollow-up drifts.\n\nSolution:\nMake next steps visible, attributable, and easy to revisit.",
        tags: ["follow-up", "accountability"],
        roles: ["Product"],
        integrations: ["tasks", "calendar"],
      },
    ],
  });

  await bootstrapAdoption(request, {
    email: GOOGLE_TEST_EMAIL,
    authorHandle: handle,
    diffSlug: adoptedDiffId,
  });

  await page.evaluate((targetPath) => {
    window.history.pushState({}, "", targetPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, `/diff/@${handle}/`);

  await expect(
    page.getByRole("heading", { name: "Adopt Test Person" })
  ).toBeVisible();
  await expect(page.getByText(`/diff-adopt-profile @${handle}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(3);
  await expect(page.getByText("1 adopted", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Register to copy/i })).toHaveCount(0);
});
