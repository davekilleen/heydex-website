import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  completeGoogleSignIn,
  getGoogleAuthStatePath,
  googleAuthSetupEnabled,
} from "./support/googleAuth";

const runGoogleAuthSetup = googleAuthSetupEnabled();
const googleAuthStatePath = getGoogleAuthStatePath();

test.describe("Google auth state setup", () => {
  test.skip(
    !runGoogleAuthSetup,
    "Set E2E_GOOGLE_EMAIL and E2E_GOOGLE_PASSWORD to capture Google auth state."
  );

  test("captures storage state for the dedicated Google test account", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    mkdirSync(path.dirname(googleAuthStatePath), { recursive: true });

    await page.goto("/connect/?return=/diff/profile/");

    const continueWithGoogle = page.getByRole("button", {
      name: /Continue with Google/i,
    });

    await expect(continueWithGoogle).toBeVisible({ timeout: 30_000 });
    await continueWithGoogle.click();

    await completeGoogleSignIn(page);
    await expect(page).toHaveURL(/\/(connect|diff\/profile)\//, {
      timeout: 60_000,
    });

    await page.context().storageState({ path: googleAuthStatePath });
  });
});
