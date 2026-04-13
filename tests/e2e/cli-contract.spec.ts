import { expect, test } from "@playwright/test";
import {
  bootstrapCliSession,
  createReviewSessionViaApi,
  getReviewStatus,
} from "./support/testApi";

test("CLI review contract can mint a review session and report unpublished status", async ({
  request,
}) => {
  const seeded = await bootstrapCliSession(request, {
    handle: `e2e-cli-${Date.now()}`,
  });

  const created = await createReviewSessionViaApi(request, {
    sessionToken: seeded.sessionToken,
    diffs: [
      {
        diffId: "cli-contract-test",
        name: "CLI Contract Test",
        description: "Validates review session creation through the public API contract.",
        methodology:
          "Problem:\nNeed a stable public contract.\n\nSolution:\nExercise /api/review/create in automation.",
        tags: ["cli", "contract"],
        roles: ["Product"],
        integrations: ["calendar"],
      },
    ],
  });

  expect(created.sessionCode).toMatch(/^[A-Z2-9]{8}$/);

  const status = await getReviewStatus(request, created.sessionCode);
  expect(status.published).toBe(false);
  expect(status.handle).toBe(seeded.handle);
});
