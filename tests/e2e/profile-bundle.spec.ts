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
