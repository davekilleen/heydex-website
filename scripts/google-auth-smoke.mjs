import { chromium } from "@playwright/test";

const remoteDebugUrl = process.env.REMOTE_DEBUG_URL ?? "http://127.0.0.1:9222";
const localAppUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const connectUrl = `${localAppUrl.replace(/\/$/, "")}/connect/?return=/diff/profile/`;

const browser = await chromium.connectOverCDP(remoteDebugUrl);
const [context] = browser.contexts();

if (!context) {
  throw new Error(`No browser context found at ${remoteDebugUrl}`);
}

const existingPage = context
  .pages()
  .find((page) => page.url().startsWith(localAppUrl));
const page = existingPage ?? (await context.newPage());

await page.goto(connectUrl, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const pathname = new URL(page.url()).pathname;
const bodyText = (await page.locator("body").innerText()).toLowerCase();

const isSelfProfile =
  pathname === "/diff/profile/" &&
  bodyText.includes("your profile") &&
  bodyText.includes("log out");

const isAuthenticatedRegistrationFlow =
  pathname === "/connect/" &&
  (bodyText.includes("let's get to know you.") ||
    bodyText.includes("complete your profile.") ||
    bodyText.includes("claim your handle."));

if (!isSelfProfile && !isAuthenticatedRegistrationFlow) {
  throw new Error(
    `Google auth smoke did not reach an authenticated Dex surface. Final URL: ${page.url()}. Run npm run e2e:google:setup first.`
  );
}

console.log(
  JSON.stringify(
    {
      url: page.url(),
      title: await page.title(),
      state: isSelfProfile ? "self-profile" : "registration-flow",
    },
    null,
    2
  )
);

await browser.close();
