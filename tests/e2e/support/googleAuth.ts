import { existsSync } from "node:fs";
import path from "node:path";
import { expect, Page } from "@playwright/test";
import { getOptionalEnv } from "./env";

const DEFAULT_GOOGLE_AUTH_STATE_PATH = "playwright/.auth/google-test-user.json";
const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";

export function getGoogleAuthStatePath() {
  const configuredPath =
    getOptionalEnv("E2E_GOOGLE_AUTH_STATE_PATH") ?? DEFAULT_GOOGLE_AUTH_STATE_PATH;

  return path.resolve(process.cwd(), configuredPath);
}

export function googleAuthSetupEnabled() {
  return Boolean(
    getOptionalEnv("E2E_GOOGLE_EMAIL") && getOptionalEnv("E2E_GOOGLE_PASSWORD")
  );
}

export function googleAuthEnabled() {
  return existsSync(getGoogleAuthStatePath());
}

export function googleAuthSkipMessage() {
  const relativeAuthStatePath = path.relative(process.cwd(), getGoogleAuthStatePath());
  return `Run npm run e2e:google:setup to create ${relativeAuthStatePath}.`;
}

export function getGoogleRedirectUri() {
  const convexSiteUrl = getOptionalEnv("CONVEX_SITE_URL");
  if (!convexSiteUrl) {
    return undefined;
  }

  return `${convexSiteUrl.replace(/\/$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

function getGoogleRedirectUriHint() {
  return (
    getGoogleRedirectUri() ?? "<CONVEX_SITE_URL>/api/auth/callback/google"
  );
}

async function throwIfGoogleOAuthConfigError(page: Page) {
  const isRedirectMismatch =
    page.url().includes("redirect_uri_mismatch") ||
    (await page.getByText(/redirect_uri_mismatch/i).isVisible().catch(() => false));
  const isBrowserRejected =
    page.url().includes("flowName=GeneralOAuthFlow") &&
    (await page
      .getByText(/this browser or app may not be secure/i)
      .isVisible()
      .catch(() => false));

  if (isRedirectMismatch) {
    throw new Error(
      `Google OAuth redirect_uri_mismatch. Add ${getGoogleRedirectUriHint()} to the Google OAuth client's authorized redirect URIs for this deployment.`
    );
  }

  if (isBrowserRejected) {
    throw new Error(
      "Google rejected the automated browser with 'This browser or app may not be secure'. Retry the auth-state setup with a real Chrome channel or use the non-prod auth bypass."
    );
  }
}

export async function completeGoogleSignIn(page: Page) {
  const email = getOptionalEnv("E2E_GOOGLE_EMAIL");
  const password = getOptionalEnv("E2E_GOOGLE_PASSWORD");

  if (!email || !password) {
    throw new Error("Google auth env vars are missing");
  }

  await page.waitForLoadState("domcontentloaded");

  const chooser = page.getByText(email, { exact: false });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
  } else {
    const emailInput = page.locator('input[type="email"]').first();
    try {
      await emailInput.waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      await throwIfGoogleOAuthConfigError(page);
      throw error;
    }
    await emailInput.fill(email);
    await page.getByRole("button", { name: /next/i }).click();
  }

  const passwordInput = page.locator('input[type="password"]').first();
  try {
    await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    await throwIfGoogleOAuthConfigError(page);
    throw error;
  }
  await passwordInput.fill(password);
  await page.getByRole("button", { name: /next/i }).click();

  const staySignedOut = page.getByRole("button", { name: /not now|skip/i });
  if (await staySignedOut.isVisible().catch(() => false)) {
    await staySignedOut.click();
  }

  await page.waitForURL(/\/(connect|diff\/profile)\//, { timeout: 60_000 });
}

export async function completeRegistrationIfNeeded(
  page: Page,
  uniqueHandle: string
) {
  if (new URL(page.url()).pathname === "/diff/profile/") {
    return;
  }

  const linkedInStep = page.getByRole("heading", { name: /let's get to know you/i });
  if (await linkedInStep.isVisible().catch(() => false)) {
    await page.getByText("I'd rather fill this in myself").click();
  }

  const profileHeading = page.getByRole("heading", { name: /complete your profile/i });
  if (await profileHeading.isVisible().catch(() => false)) {
    await page.getByPlaceholder("Your name").fill("DexDiff Google E2E");
    await page.getByPlaceholder("e.g., CPO at Acme Corp").fill("VP Product at Heydex");
    await page.getByRole("button", { name: "Product" }).click();
    await page.getByLabel("VP").check();
    await page.getByPlaceholder("A brief summary of what you do...").fill(
      "An end-to-end Google auth test account for validating the DexDiff registration flow."
    );
    await page.getByRole("button", { name: /looks good/i }).click();
  }

  const handleHeading = page.getByRole("heading", { name: /claim your handle/i });
  await expect(handleHeading).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder("yourhandle").fill(uniqueHandle);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect
    .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
    .toBe("/diff/profile/");
}
