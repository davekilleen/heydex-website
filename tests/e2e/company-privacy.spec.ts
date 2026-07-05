import { expect, test } from "@playwright/test";
import {
  bootstrapAuthState,
  bootstrapCompanyDomain,
  bootstrapReviewSession,
  getCompanyForHandle,
  installAuthState,
  publishReviewSession,
  setVisibilityAsUser,
  updateReviewVisibility,
} from "./support/testApi";

function uniqueDomain(prefix: string) {
  return `${prefix}-${Date.now()}.example`;
}

test("company view hides private members from every identifying aggregate", async ({
  request,
}) => {
  const domain = uniqueDomain("privacy");
  const privateHandle = `private-${Date.now()}`;
  const colleaguesHandle = `colleague-${Date.now()}`;
  const publicHandle = `public-${Date.now()}`;

  await bootstrapCompanyDomain(request, {
    domain,
    company: "Privacy Systems",
    members: [
      {
        handle: privateHandle,
        displayName: "Private Person",
        title: "Chief of Staff",
        function_: "Operations",
        integrations: ["private-crm"],
        visibility: "private",
        diffs: [
          {
            diffId: "private-operating-rhythm",
            name: "Private Operating Rhythm",
            description: "This should never appear in company lists.",
            methodology: "Private methodology",
            tags: ["private"],
            roles: ["Operations"],
            integrations: ["private-crm"],
          },
        ],
      },
      {
        handle: colleaguesHandle,
        displayName: "Colleague Person",
        title: "VP Product",
        function_: "Product",
        integrations: ["calendar", "gmail"],
        visibility: "colleagues",
        diffs: [
          {
            diffId: "colleague-product-review",
            name: "Colleague Product Review",
            description: "A visible company workflow.",
            methodology: "Visible methodology",
            tags: ["product"],
            roles: ["Product"],
            integrations: ["calendar"],
          },
        ],
      },
      {
        handle: publicHandle,
        displayName: "Public Person",
        title: "Revenue Lead",
        function_: "Sales",
        integrations: ["salesforce"],
        visibility: "public",
        diffs: [
          {
            diffId: "public-pipeline-review",
            name: "Public Pipeline Review",
            description: "Another visible company workflow.",
            methodology: "Public methodology",
            tags: ["sales"],
            roles: ["Sales"],
            integrations: ["salesforce"],
          },
        ],
      },
    ],
  });

  const company = await getCompanyForHandle(request, colleaguesHandle);

  expect(company.domain).toBe(domain);
  expect(company.memberCount).toBe(3);
  expect(company.colleagues.map((member: { handle: string }) => member.handle).sort()).toEqual(
    [colleaguesHandle, publicHandle].sort()
  );
  expect(company.diffs.map((diff: { diffId: string }) => diff.diffId).sort()).toEqual(
    ["colleague-product-review", "public-pipeline-review"].sort()
  );
  expect(company.integrations).toMatchObject({
    calendar: ["Colleague Person"],
    gmail: ["Colleague Person"],
    salesforce: ["Public Person"],
  });
  expect(company.functionBreakdown).toEqual({
    Product: 1,
    Sales: 1,
  });

  const serialized = JSON.stringify(company);
  expect(serialized).not.toContain(privateHandle);
  expect(serialized).not.toContain("Private Person");
  expect(serialized).not.toContain("Private Operating Rhythm");
  expect(serialized).not.toContain("private-crm");
});

test("personal email users cannot choose colleagues visibility in backend or UI", async ({
  page,
  request,
}) => {
  const handle = `personal-${Date.now()}`;
  const email = `${handle}@gmail.com`;
  const authState = await bootstrapAuthState(request, {
    handle,
    email,
    displayName: "Personal Mail",
    title: "Founder",
    visibility: "private",
  });

  await expect(setVisibilityAsUser(authState, "colleagues")).rejects.toThrow(
    /COLLEAGUES_REQUIRES_COMPANY/
  );

  await installAuthState(page, authState);
  await page.goto("/diff/profile/");

  const profileColleaguesOption = page
    .locator(".profile-visibility-option")
    .filter({ hasText: "Colleagues only" });
  await expect(profileColleaguesOption).toBeDisabled();
  await expect(profileColleaguesOption).toContainText(/work email/i);

  const profilePublicOption = page
    .locator(".profile-visibility-option")
    .filter({ hasText: "Public" });
  await expect(profilePublicOption).toContainText(/coming soon/i);
  await expect(profilePublicOption.locator("em", { hasText: "Recommended" })).toHaveCount(0);

  const review = await bootstrapReviewSession(request, {
    handle: `${handle}-review`,
    email: `review-${handle}@gmail.com`,
    displayName: "Review Personal Mail",
    title: "Founder",
    visibility: "private",
  });

  await expect(updateReviewVisibility(review.sessionCode, "colleagues")).rejects.toThrow(
    /COLLEAGUES_REQUIRES_COMPANY/
  );

  const invalidPublishReview = await bootstrapReviewSession(request, {
    handle: `${handle}-publish-review`,
    email: `publish-review-${handle}@gmail.com`,
    displayName: "Publish Review Personal Mail",
    title: "Founder",
    visibility: "colleagues",
  });
  await expect(publishReviewSession(invalidPublishReview.sessionCode)).rejects.toThrow(
    /COLLEAGUES_REQUIRES_COMPANY/
  );

  await page.goto(`/diff/review/?session=${review.sessionCode}`);

  const reviewColleaguesOption = page
    .locator(".review-audience-option")
    .filter({ hasText: "Colleagues only" });
  await expect(reviewColleaguesOption).toBeDisabled();
  await expect(reviewColleaguesOption).toContainText(/work email/i);

  const reviewPublicOption = page
    .locator(".review-audience-option")
    .filter({ hasText: "Public" });
  await expect(reviewPublicOption).toContainText(/coming soon/i);
  await expect(
    reviewPublicOption.locator(".review-recommended-pill", { hasText: "Recommended" })
  ).toHaveCount(0);
});

test("cross-domain callers only receive their own company data", async ({
  request,
}) => {
  const firstDomain = uniqueDomain("first-domain");
  const secondDomain = uniqueDomain("second-domain");
  const firstHandle = `first-${Date.now()}`;
  const secondHandle = `second-${Date.now()}`;

  await bootstrapCompanyDomain(request, {
    domain: firstDomain,
    company: "First Domain",
    members: [
      {
        handle: firstHandle,
        displayName: "First Domain Person",
        visibility: "colleagues",
        integrations: ["first-tool"],
        diffs: [
          {
            diffId: "first-domain-workflow",
            name: "First Domain Workflow",
            description: "Should stay inside the first domain.",
            methodology: "First methodology",
            tags: ["first"],
            roles: ["Product"],
            integrations: ["first-tool"],
          },
        ],
      },
    ],
  });

  await bootstrapCompanyDomain(request, {
    domain: secondDomain,
    company: "Second Domain",
    members: [
      {
        handle: secondHandle,
        displayName: "Second Domain Person",
        visibility: "colleagues",
        integrations: ["second-tool"],
      },
    ],
  });

  const company = await getCompanyForHandle(request, secondHandle);
  const serialized = JSON.stringify(company);

  expect(company.domain).toBe(secondDomain);
  expect(serialized).toContain(secondHandle);
  expect(serialized).not.toContain(firstDomain);
  expect(serialized).not.toContain(firstHandle);
  expect(serialized).not.toContain("First Domain Workflow");
  expect(serialized).not.toContain("first-tool");
});
