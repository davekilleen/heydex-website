import { expect, test } from "@playwright/test";
import { checkHandle } from "./support/testApi";

test.skip(
  process.env.E2E_REQUIRE_AUTH !== "1",
  "Auth-gate coverage only runs when E2E_REQUIRE_AUTH=1.",
);

test("anonymous diff browse redirects to connect with a return target", async ({ page }) => {
  await page.goto("/diff/");

  await page.waitForURL(/\/connect\/\?return=/);
  const redirectedUrl = new URL(page.url());

  expect(redirectedUrl.pathname).toBe("/connect/");
  expect(redirectedUrl.searchParams.get("return")).toBe("/diff/");
});

test("anonymous public profile alias redirects to connect with a return target", async ({ page }) => {
  await page.goto("/diff/@somehandle/?from=e2e");

  await page.waitForURL(/\/connect\/\?return=/);
  const redirectedUrl = new URL(page.url());

  expect(redirectedUrl.pathname).toBe("/connect/");
  expect(redirectedUrl.searchParams.get("return")).toBe("/diff/@somehandle/?from=e2e");
});

test("anonymous canonical public profile redirects to connect with a return target", async ({ page }) => {
  await page.goto("/diff/somehandle/?from=e2e");

  await page.waitForURL(/\/connect\/\?return=/);
  const redirectedUrl = new URL(page.url());

  expect(redirectedUrl.pathname).toBe("/connect/");
  expect(redirectedUrl.searchParams.get("return")).toBe("/diff/somehandle/?from=e2e");
});

test("reserved handles are unavailable", async () => {
  await expect.poll(async () => await checkHandle("admin")).toMatchObject({
    available: false,
    reason: "reserved",
  });
});
