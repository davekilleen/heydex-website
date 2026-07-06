import { expect, test } from "@playwright/test";
import {
  bootstrapAuthState,
  bootstrapCompanyDomain,
  bootstrapPublicProfile,
  installAuthState,
} from "./support/testApi";

function uniqueHandle(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

test("profile Open in Dex shows the attempting state", async ({
  page,
  request,
}) => {
  const viewerHandle = uniqueHandle("adopt-viewer");
  const profileHandle = uniqueHandle("adopt-profile");
  const authState = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@heydex.example`,
    displayName: "Adopt Viewer",
    visibility: "colleagues",
  });

  await bootstrapPublicProfile(request, {
    handle: profileHandle,
    displayName: "Interstitial Profile",
    title: "Product Lead",
    company: "Heydex",
    summary: "A profile seeded for the Open in Dex interstitial.",
    visibility: "public",
    diffs: [
      {
        diffId: "weekly-exec-prep",
        name: "Weekly Exec Prep",
        description: "Bring the right context into a weekly exec meeting.",
        methodology: "Problem:\nContext drifts.\n\nSolution:\nCollect it before the meeting.",
        tags: ["meetings"],
        roles: ["Product"],
        integrations: ["calendar"],
      },
    ],
  });

  await installAuthState(page, authState);
  await page.goto(`/diff/${profileHandle}/`);

  await expect(
    page.getByRole("heading", { name: "Interstitial Profile" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open in Dex" })).toHaveCount(2);

  await page
    .locator(".public-profile-adopt-card")
    .getByRole("button", { name: "Open in Dex" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Opening Dex..." })
  ).toBeVisible();
});

test("profile Open in Dex timeout shows download and profile command fallback", async ({
  page,
  request,
}) => {
  const viewerHandle = uniqueHandle("adopt-timeout-viewer");
  const profileHandle = uniqueHandle("adopt-timeout-profile");
  const authState = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@heydex.example`,
    displayName: "Timeout Viewer",
    visibility: "colleagues",
  });

  await bootstrapPublicProfile(request, {
    handle: profileHandle,
    displayName: "Timeout Profile",
    title: "Revenue Lead",
    company: "Heydex",
    summary: "A profile seeded for fallback coverage.",
    visibility: "public",
  });

  await installAuthState(page, authState);
  await page.goto(`/diff/${profileHandle}/`);
  await expect(
    page.getByRole("heading", { name: "Timeout Profile" })
  ).toBeVisible();

  await page.clock.install();
  await page
    .locator(".public-profile-adopt-card")
    .getByRole("button", { name: "Open in Dex" })
    .click();
  await page.clock.fastForward(2600);

  await expect(page.getByRole("heading", { name: "Didn't open?" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download Dex for Mac" })
  ).toHaveAttribute("href", "https://heydex.ai/desktop/");
  // Scope to the dialog: the same command legitimately also renders on the
  // page's own clone-command block.
  await expect(
    page.getByLabel("Didn't open?").getByText(`/diff-adopt-profile @${profileHandle}`)
  ).toBeVisible();
});

test("company workflow Open in Dex fallback uses the per-diff command", async ({
  page,
  request,
}) => {
  const domain = `adopt-company-${Date.now()}.example`;
  const viewerHandle = uniqueHandle("adopt-company-viewer");
  const colleagueHandle = uniqueHandle("adopt-company-author");
  const diffId = "company-revenue-review";

  await bootstrapCompanyDomain(request, {
    domain,
    company: "Adopt Company",
    members: [
      {
        handle: viewerHandle,
        displayName: "Company Viewer",
        title: "VP Product",
        function_: "Product",
        visibility: "colleagues",
      },
      {
        handle: colleagueHandle,
        displayName: "Company Author",
        title: "Revenue Lead",
        function_: "Sales",
        visibility: "colleagues",
        diffs: [
          {
            diffId,
            name: "Company Revenue Review",
            description: "Review company revenue signals before team sync.",
            methodology: "Problem:\nRevenue context is scattered.\n\nSolution:\nReview the signals together.",
            tags: ["sales"],
            roles: ["Sales"],
            integrations: ["salesforce"],
          },
        ],
      },
    ],
  });

  const authState = await bootstrapAuthState(request, {
    handle: viewerHandle,
    email: `${viewerHandle}@${domain}`,
    displayName: "Company Viewer",
    title: "VP Product",
    company: "Adopt Company",
    visibility: "colleagues",
  });

  await installAuthState(page, authState);
  await page.goto("/diff/company/");
  await expect(
    page.getByRole("heading", { name: "Company Revenue Review" })
  ).toBeVisible();

  await page.clock.install();
  await page
    .locator(".company-workflow-card", {
      has: page.getByRole("heading", { name: "Company Revenue Review" }),
    })
    .getByRole("button", { name: "Open in Dex" })
    .click();
  await page.clock.fastForward(2600);

  await expect(page.getByRole("heading", { name: "Didn't open?" })).toBeVisible();
  await expect(
    page.getByLabel("Didn't open?").getByText(`/diff-adopt @${colleagueHandle}/${diffId}`)
  ).toBeVisible();
});
