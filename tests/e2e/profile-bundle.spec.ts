import { expect, test } from "@playwright/test";
import { bootstrapPublicProfile } from "./support/testApi";
import { getEnv } from "./support/env";

test("public API exposes single-diff yaml and full profile bundle contracts", async ({ request }) => {
  const handle = `bundle-${Date.now()}`;
  const diffs = [
    {
      diffId: "meeting-prep",
      name: "Meeting Prep",
      description: "Turn people, notes, and open loops into one prep layer.",
      methodology:
        "dexdiff_schema: \"2.0\"\nname: Meeting Prep\nproblem: Context is fragmented.\nsolution: Pull it together before the meeting.",
      tags: ["meetings", "prep"],
      roles: ["Product"],
      integrations: ["calendar", "gmail"],
    },
    {
      diffId: "follow-through",
      name: "Follow Through",
      description: "Turn meeting outcomes into visible next steps.",
      methodology:
        "dexdiff_schema: \"2.0\"\nname: Follow Through\nproblem: Follow-up drifts.\nsolution: Convert it into tracked actions.",
      tags: ["follow-up", "accountability"],
      roles: ["Product"],
      integrations: ["tasks", "calendar"],
    },
  ];

  await bootstrapPublicProfile(request, {
    handle,
    displayName: "Bundle Test",
    title: "VP Product",
    company: "Heydex",
    summary: "Bundle export fixture.",
    loveLetter: "Dex made my work feel less scattered and more deliberate.",
    diffs,
  });

  const apiBaseUrl = getEnv("E2E_API_BASE_URL").replace(/\/$/, "");

  const diffResponse = await request.get(
    `${apiBaseUrl}/diff?author=${encodeURIComponent(handle)}&id=${encodeURIComponent(diffs[0].diffId)}`,
  );
  await expect(diffResponse).toBeOK();
  const diffBody = await diffResponse.text();
  expect(diffBody).toContain("dexdiff_schema");
  expect(diffBody).toContain("Meeting Prep");

  const bundleResponse = await request.get(
    `${apiBaseUrl}/profile-bundle?handle=${encodeURIComponent(handle)}`,
  );
  await expect(bundleResponse).toBeOK();
  const bundle = await bundleResponse.json();

  expect(bundle.contractVersion).toBe("2026-04-10");
  expect(bundle.profile.handle).toBe(handle);
  expect(bundle.workflows).toHaveLength(2);
  expect(bundle.workflows[0].diffId).toBe("meeting-prep");
  expect(bundle.workflows[0].methodology).toContain("dexdiff_schema");
  expect(bundle.workflows[1].diffId).toBe("follow-through");
  expect(bundle.loveLetter?.text).toContain("less scattered");
});

test("anonymous diff API hides private authors without starving public results", async ({
  request,
}) => {
  const stamp = Date.now();
  const publicHandle = `visible-${stamp}`;
  const privateHandle = `hidden-${stamp}`;
  const role = `Visibility Role ${stamp}`;
  const publicDiffId = "visible-methodology";
  const privateDiffId = "hidden-methodology";

  await bootstrapPublicProfile(request, {
    handle: publicHandle,
    displayName: "Visible Author",
    visibility: "public",
    diffs: [
      {
        diffId: publicDiffId,
        name: "Visible Methodology",
        description: "A public workflow that should still fill the browse page.",
        methodology:
          "dexdiff_schema: \"2.0\"\nname: Visible Methodology\nproblem: Public rows can be hidden behind private rows.\nsolution: Filter after fetching a small buffer.",
        tags: ["visibility"],
        roles: [role],
        integrations: ["calendar"],
      },
    ],
  });

  await bootstrapPublicProfile(request, {
    handle: privateHandle,
    displayName: "Hidden Author",
    visibility: "private",
    diffs: [
      {
        diffId: privateDiffId,
        name: "Hidden Methodology",
        description: "A private workflow that should not appear in anonymous reads.",
        methodology:
          "dexdiff_schema: \"2.0\"\nname: Hidden Methodology\nproblem: Private profile data leaked.\nsolution: Require public author visibility.",
        tags: ["visibility"],
        roles: [role],
        integrations: ["calendar"],
      },
    ],
  });

  const apiBaseUrl = getEnv("E2E_API_BASE_URL").replace(/\/$/, "");
  const listResponse = await request.get(
    `${apiBaseUrl}/diffs?role=${encodeURIComponent(role)}&limit=1`,
  );
  await expect(listResponse).toBeOK();
  const listedDiffs = (await listResponse.json()) as Array<{
    authorHandle: string;
    diffId: string;
  }>;

  expect(listedDiffs).toEqual([
    expect.objectContaining({
      authorHandle: publicHandle,
      diffId: publicDiffId,
    }),
  ]);

  const privateDiffResponse = await request.get(
    `${apiBaseUrl}/diff?author=${encodeURIComponent(privateHandle)}&id=${encodeURIComponent(privateDiffId)}`,
  );
  expect(privateDiffResponse.status()).toBe(404);
  await expect(privateDiffResponse).not.toBeOK();
  expect(await privateDiffResponse.json()).toEqual({ error: "Diff not found" });
});
