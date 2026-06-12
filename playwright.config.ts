import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const reuseExistingServer =
  process.env.E2E_REUSE_EXISTING_SERVER === "0" ? false : process.env.CI ? false : true;
const webServerCommand =
  process.env.E2E_WEB_SERVER_COMMAND ?? "npm run dev -- --host 127.0.0.1";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/google-auth.setup.ts"],
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "output/playwright/report", open: "never" }],
  ],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer,
    timeout: 120_000,
  },
});
