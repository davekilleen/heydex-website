import { chromium } from "@playwright/test";

const remoteDebugUrl = process.env.REMOTE_DEBUG_URL ?? "http://127.0.0.1:9222";
const localAppUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const connectUrl = `${localAppUrl.replace(/\/$/, "")}/connect/?return=/diff/profile/`;
const email = process.env.E2E_GOOGLE_EMAIL;
const password = process.env.E2E_GOOGLE_PASSWORD;

if (!email || !password) {
  throw new Error("Missing E2E_GOOGLE_EMAIL or E2E_GOOGLE_PASSWORD");
}

const browser = await chromium.connectOverCDP(remoteDebugUrl);
const [context] = browser.contexts();

if (!context) {
  throw new Error(`No browser context found at ${remoteDebugUrl}`);
}

const existingPage = context.pages().find((page) => {
  const url = page.url();
  return url.startsWith(localAppUrl) || url.includes("accounts.google.com");
});
const page = existingPage ?? (await context.newPage());

async function clickIfVisible(locator) {
  try {
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
      await locator.click();
      return true;
    }
  } catch {}
  return false;
}

async function fillIfVisible(locator, value) {
  try {
    if (await locator.isVisible({ timeout: 500 }).catch(() => false)) {
      await locator.fill(value);
      return true;
    }
  } catch {}
  return false;
}

async function currentBodyText() {
  return (await page.locator("body").innerText().catch(() => "")).toLowerCase();
}

function currentPathname() {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "";
  }
}

async function assertNoKnownOAuthErrors() {
  const url = page.url();
  const bodyText = await currentBodyText();

  if (url.includes("redirect_uri_mismatch") || bodyText.includes("redirect_uri_mismatch")) {
    throw new Error(
      "Google OAuth redirect_uri_mismatch. Run npm run e2e:google:redirect-uri and add that URI to the Google OAuth client."
    );
  }

  if (
    url.includes("flowName=GeneralOAuthFlow") &&
    bodyText.includes("this browser or app may not be secure")
  ) {
    throw new Error(
      "Google rejected the browser as insecure. Use the dedicated Chrome session started by npm run e2e:google:setup."
    );
  }
}

function isAuthenticatedDexSurface(pathname, bodyText) {
  if (pathname === "/diff/profile/") {
    return bodyText.includes("your profile") && bodyText.includes("log out");
  }

  if (pathname === "/connect/") {
    return (
      bodyText.includes("let's get to know you.") ||
      bodyText.includes("complete your profile.") ||
      bodyText.includes("claim your handle.")
    );
  }

  return false;
}

await page.goto(connectUrl, { waitUntil: "domcontentloaded" });

for (let attempt = 0; attempt < 45; attempt += 1) {
  await assertNoKnownOAuthErrors();

  const pathname = currentPathname();
  const bodyText = await currentBodyText();

  if (isAuthenticatedDexSurface(pathname, bodyText)) {
    console.log(
      JSON.stringify(
        {
          url: page.url(),
          title: await page.title(),
          state: pathname === "/diff/profile/" ? "self-profile" : "registration-flow",
        },
        null,
        2
      )
    );
    await browser.close();
    process.exit(0);
  }

  if (pathname === "/connect/" && bodyText.includes("continue with google")) {
    await clickIfVisible(page.getByRole("button", { name: /Continue with Google/i }));
  }

  await clickIfVisible(page.getByRole("link", { name: new RegExp(email, "i") }));
  await clickIfVisible(page.getByText(email, { exact: false }));

  const emailInput = page.locator('input[type="email"]').first();
  if (await fillIfVisible(emailInput, email)) {
    await clickIfVisible(page.getByRole("button", { name: /next/i }));
  }

  const passwordInput = page.locator('input[type="password"]').first();
  if (await fillIfVisible(passwordInput, password)) {
    await clickIfVisible(page.getByRole("button", { name: /next/i }));
  }

  await clickIfVisible(page.getByRole("button", { name: /^Continue$/i }));
  await clickIfVisible(page.getByRole("button", { name: /not now|skip/i }));

  await page.waitForTimeout(2000);
}

throw new Error(`Google auth bootstrap did not reach a Dex surface. Final URL: ${page.url()}`);
