import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const statePath = path.resolve(
  process.cwd(),
  process.env.E2E_GOOGLE_AUTH_STATE_PATH ?? "playwright/.auth/google-test-user.json"
);

const remoteDebugUrl = process.env.REMOTE_DEBUG_URL ?? "http://127.0.0.1:9222";
const browser = await chromium.connectOverCDP(remoteDebugUrl);
const [context] = browser.contexts();

if (!context) {
  throw new Error("No browser context found on the connected Chrome instance.");
}

const originsToCapture = [
  "http://127.0.0.1:3000",
  "https://heydex.ai",
];

const storageEntries = await Promise.all(
  originsToCapture.map(async (origin) => {
    const page = context
      .pages()
      .find((candidate) => candidate.url().startsWith(`${origin}/`));

    if (!page) {
      return null;
    }

    const localStorage = await page.evaluate(() =>
      Object.entries(localStorage).map(([name, value]) => ({ name, value }))
    );

    if (localStorage.length === 0) {
      return null;
    }

    return { origin, localStorage };
  })
);

const capturedOrigins = storageEntries.filter(Boolean);

if (capturedOrigins.length === 0) {
  throw new Error(
    "No auth localStorage entries were found on localhost or heydex.ai pages."
  );
}

let state;
if (existsSync(statePath)) {
  state = JSON.parse(readFileSync(statePath, "utf8"));
} else {
  state = await context.storageState();
}

const existingOrigins = new Map(
  (state.origins ?? []).map((originState) => [originState.origin, originState])
);

for (const originState of capturedOrigins) {
  existingOrigins.set(originState.origin, originState);
}

state.origins = Array.from(existingOrigins.values());

mkdirSync(path.dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2));

console.log(
  `Saved auth state to ${statePath} for ${capturedOrigins
    .map((entry) => entry.origin)
    .join(", ")}`
);

await browser.close();
