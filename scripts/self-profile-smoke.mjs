import { chromium } from "@playwright/test";

const remoteDebugUrl = process.env.REMOTE_DEBUG_URL ?? "http://127.0.0.1:9222";
const localAppUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

const browser = await chromium.connectOverCDP(remoteDebugUrl);
const [context] = browser.contexts();

if (!context) {
  throw new Error(`No browser context found at ${remoteDebugUrl}`);
}

const page = await context.newPage();
const targetUrl = `${localAppUrl.replace(/\/$/, "")}/diff/profile/`;

try {
  await page.goto(targetUrl, {
    waitUntil: "domcontentloaded",
  });
} catch (error) {
  if (!String(error).includes("net::ERR_ABORTED")) {
    throw error;
  }
}
await page.waitForTimeout(3000);

if (new URL(page.url()).pathname !== "/diff/profile/") {
  throw new Error(
    `Did not reach self profile. Run npm run e2e:google:setup first. Final URL: ${page.url()}`
  );
}

const bodyText = (await page.locator("body").innerText()).toLowerCase();
for (const required of ["clone command", "who can see it?", "log out"]) {
  if (!bodyText.includes(required)) {
    throw new Error(`Missing self-profile surface: ${required}`);
  }
}

console.log(JSON.stringify({ url: page.url(), title: await page.title() }, null, 2));

await browser.close();
