import { expect, test } from "@playwright/test";
import {
  bootstrapAuthState,
  bootstrapCompanyDomain,
  installAuthState,
} from "./support/testApi";

function uniqueDomain(prefix: string) {
  return `${prefix}-${Date.now()}.example`;
}

test("company page explains the no-company state without exposing data", async ({
  page,
  request,
}) => {
  const handle = `company-personal-${Date.now()}`;
  const authState = await bootstrapAuthState(request, {
    handle,
    email: `${handle}@gmail.com`,
    displayName: "Company Personal",
    visibility: "private",
  });

  await installAuthState(page, authState);
  await page.goto("/diff/company/");

  await expect(page.getByRole("heading", { name: /No company workspace yet/i })).toBeVisible();
  await expect(page.getByText(/sign in with a work email/i)).toBeVisible();
  await expect(page.locator(".company-roster-card")).toHaveCount(0);
  await expect(page.locator(".company-integration-grid")).toHaveCount(0);
});

test("single visible member gets an invite-colleagues empty state", async ({
  page,
  request,
}) => {
  const domain = uniqueDomain("solo-company");
  const handle = `solo-${Date.now()}`;
  const authState = await bootstrapAuthState(request, {
    handle,
    email: `${handle}@${domain}`,
    displayName: "Solo Company Member",
    title: "VP Product",
    company: "Solo Systems",
    visibility: "colleagues",
    integrations: ["calendar"],
  });

  await installAuthState(page, authState);
  await page.goto("/diff/company/");

  await expect(page.getByRole("heading", { name: /How Solo Systems uses Dex/i })).toBeVisible();
  await expect(page.getByText(/Invite colleagues/i)).toBeVisible();
  await expect(page.locator(".company-roster-card")).toHaveCount(1);
  await expect(page.locator(".company-integration-grid")).toHaveCount(0);
});

test("company page renders roster, workflows, integrations, and profile deep links", async ({
  page,
  request,
}) => {
  const domain = uniqueDomain("team-company");
  const callerHandle = `caller-${Date.now()}`;
  const colleagueHandle = `colleague-${Date.now()}`;

  await bootstrapCompanyDomain(request, {
    domain,
    company: "Team Systems",
    members: [
      {
        handle: callerHandle,
        displayName: "Caller Member",
        title: "VP Product",
        function_: "Product",
        integrations: ["calendar"],
        visibility: "colleagues",
      },
      {
        handle: colleagueHandle,
        displayName: "Colleague Member",
        title: "Revenue Lead",
        function_: "Sales",
        integrations: ["gmail", "salesforce"],
        visibility: "public",
        diffs: [
          {
            diffId: "team-pipeline-review",
            name: "Team Pipeline Review",
            description: "Review pipeline and next steps before team meetings.",
            methodology: "Team methodology",
            tags: ["sales", "pipeline"],
            roles: ["Sales"],
            integrations: ["gmail", "salesforce"],
            adoptionCount: 4,
          },
        ],
      },
    ],
  });

  const authState = await bootstrapAuthState(request, {
    handle: callerHandle,
    email: `${callerHandle}@${domain}`,
    displayName: "Caller Member",
    title: "VP Product",
    company: "Team Systems",
    visibility: "colleagues",
  });

  await installAuthState(page, authState);
  await page.goto("/diff/company/");

  await expect(page.getByRole("heading", { name: /How Team Systems uses Dex/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Caller Member" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Colleague Member" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team Pipeline Review" })).toBeVisible();
  await expect(page.getByText(/4 adoptions/i)).toBeVisible();
  await expect(page.getByText("gmail")).toBeVisible();
  await expect(page.getByText("salesforce")).toBeVisible();

  await page.getByRole("link", { name: /View Colleague Member workflow/i }).click();
  await page.waitForURL(new RegExp(`/diff/${colleagueHandle}/?$`), { timeout: 30_000 });
});
