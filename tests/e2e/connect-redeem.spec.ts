import { expect, test } from "@playwright/test";
import {
  bootstrapCliSession,
  bootstrapConnectionCode,
  createReviewSessionViaApi,
  createReviewSessionViaApiExpectError,
  redeemConnectionCode,
  redeemConnectionCodeExpectError,
} from "./support/testApi";

const REVIEW_DIFFS = [
  {
    diffId: "redeem-contract-test",
    name: "Redeem Contract Test",
    description: "Validates the CLI auth bridge and session-token lifecycle.",
    methodology:
      "Problem:\nCLI auth can drift.\n\nSolution:\nExercise connect/redeem and review/create together.",
    tags: ["cli", "auth"],
    roles: ["Product"],
    integrations: ["calendar"],
  },
];

test("fresh connection code redeems into a usable CLI session token", async ({ request }) => {
  const seeded = await bootstrapConnectionCode(request, {
    handle: `redeem-ok-${Date.now()}`,
  });

  const redeemed = await redeemConnectionCode(request, seeded.code);
  expect(redeemed.handle).toBe(seeded.handle);
  expect(redeemed.sessionToken).toMatch(/^[a-f0-9]{32}$/);

  const created = await createReviewSessionViaApi(request, {
    sessionToken: redeemed.sessionToken,
    diffs: REVIEW_DIFFS,
  });
  expect(created.sessionCode).toMatch(/^[A-Z2-9]{8}$/);
});

test("invalid, expired, and already-used connection codes are rejected", async ({ request }) => {
  const fresh = await bootstrapConnectionCode(request, {
    handle: `redeem-used-${Date.now()}`,
  });
  await redeemConnectionCode(request, fresh.code);

  const usedCode = await redeemConnectionCodeExpectError(request, fresh.code);
  expect(usedCode.status).toBe(401);
  expect(usedCode.body.error).toBe("Code already used");

  const expired = await bootstrapConnectionCode(request, {
    handle: `redeem-expired-${Date.now()}`,
    expired: true,
  });
  const expiredCode = await redeemConnectionCodeExpectError(request, expired.code);
  expect(expiredCode.status).toBe(401);
  expect(expiredCode.body.error).toBe("Code expired");

  const invalidCode = await redeemConnectionCodeExpectError(request, "ABC123");
  expect(invalidCode.status).toBe(401);
  expect(invalidCode.body.error).toBe("Invalid code");
});

test("expired CLI session tokens cannot mint review sessions", async ({ request }) => {
  const expiredSession = await bootstrapCliSession(request, {
    handle: `cli-expired-${Date.now()}`,
    expired: true,
  });

  const result = await createReviewSessionViaApiExpectError(request, {
    sessionToken: expiredSession.sessionToken,
    diffs: REVIEW_DIFFS,
  });
  expect(result.status).toBe(401);
  expect(result.body.error).toBe("Invalid or expired session");
});
