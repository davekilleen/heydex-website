import { existsSync } from "node:fs";
import path from "node:path";
import { expect, Page } from "@playwright/test";
import { getOptionalEnv } from "./env";

const DEFAULT_GOOGLE_AUTH_STATE_PATH = "playwright/.auth/google-test-user.json";

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
    await emailInput.waitFor({ state: "visible", timeout: 30_000 });
    await emailInput.fill(email);
    await page.getByRole("button", { name: /next/i }).click();
  }

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
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
  if (page.url().includes("/diff/profile/")) {
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
  await page.waitForURL(/\/diff\/profile\//, { timeout: 60_000 });
}
