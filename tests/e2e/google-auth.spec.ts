import { expect, test } from "@playwright/test";
import {
  completeRegistrationIfNeeded,
  googleAuthEnabled,
  googleAuthSkipMessage,
  getGoogleAuthStatePath,
} from "./support/googleAuth";

const runGoogleAuth = googleAuthEnabled();
const googleAuthStatePath = getGoogleAuthStatePath();

test.use({ storageState: googleAuthStatePath });

test.describe("Google auth flow", () => {
  test.skip(
    !runGoogleAuth,
    googleAuthSkipMessage()
  );

  test("saved auth state reaches the authenticated profile flow", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    const uniqueHandle = `dexgoogle${Date.now().toString().slice(-8)}`;

    await page.goto("/connect/?return=/diff/profile/");
    await completeRegistrationIfNeeded(page, uniqueHandle);

    await page.waitForURL(/\/diff\/profile\//, { timeout: 60_000 });
    await expect(page.getByText(/Your profile/i)).toBeVisible();
  });
});
