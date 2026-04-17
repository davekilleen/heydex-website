import { APIRequestContext, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { getEnv } from "./env";

export type ReviewSeedOptions = {
  handle?: string;
  displayName?: string;
  title?: string;
  company?: string;
  summary?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  visibility?: "private" | "colleagues" | "public";
  expired?: boolean;
  redeemed?: boolean;
};

function getApiBaseUrl() {
  return getEnv("E2E_API_BASE_URL").replace(/\/$/, "");
}

function getConvexUrl() {
  return getEnv("VITE_CONVEX_URL");
}

let convexClient: ConvexHttpClient | null = null;

function getConvexClient() {
  if (!convexClient) {
    convexClient = new ConvexHttpClient(getConvexUrl());
  }
  return convexClient;
}

function getTestSecretHeader() {
  return {
    "x-heydex-test-secret": getEnv("E2E_TEST_SECRET"),
    "content-type": "application/json",
  };
}

export async function bootstrapReviewSession(
  request: APIRequestContext,
  options: ReviewSeedOptions = {}
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-review`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function bootstrapCliSession(
  request: APIRequestContext,
  options: ReviewSeedOptions = {}
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-cli`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function bootstrapConnectionCode(
  request: APIRequestContext,
  options: ReviewSeedOptions = {}
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-connect-code`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function bootstrapPublicProfile(
  request: APIRequestContext,
  options: ReviewSeedOptions & {
    loveLetter?: string;
    diffs?: Array<{
      diffId: string;
      name: string;
      description: string;
      methodology: string;
      tags: string[];
      roles: string[];
      integrations: string[];
    }>;
  } = {}
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-public-profile`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function bootstrapAdoption(
  request: APIRequestContext,
  args: {
    email: string;
    authorHandle: string;
    diffSlug: string;
  }
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-adoption`, {
    headers: getTestSecretHeader(),
    data: args,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function createReviewSessionViaApi(
  request: APIRequestContext,
  args: {
    sessionToken: string;
    diffs: Array<{
      diffId: string;
      name: string;
      description: string;
      methodology: string;
      tags: string[];
      roles: string[];
      integrations: string[];
    }>;
  }
) {
  const response = await request.post(`${getApiBaseUrl()}/review/create`, {
    headers: {
      "content-type": "application/json",
    },
    data: args,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function createReviewSessionViaApiExpectError(
  request: APIRequestContext,
  args: {
    sessionToken?: string;
    diffs: Array<{
      diffId: string;
      name: string;
      description: string;
      methodology: string;
      tags: string[];
      roles: string[];
      integrations: string[];
    }>;
  }
) {
  const response = await request.post(`${getApiBaseUrl()}/review/create`, {
    headers: {
      "content-type": "application/json",
    },
    data: args,
  });
  expect(response.ok()).toBe(false);
  return {
    status: response.status(),
    body: await response.json(),
  };
}

export async function redeemConnectionCode(
  request: APIRequestContext,
  code: string
) {
  const response = await request.post(`${getApiBaseUrl()}/connect/redeem`, {
    headers: {
      "content-type": "application/json",
    },
    data: { code },
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function redeemConnectionCodeExpectError(
  request: APIRequestContext,
  code: string
) {
  const response = await request.post(`${getApiBaseUrl()}/connect/redeem`, {
    headers: {
      "content-type": "application/json",
    },
    data: { code },
  });
  expect(response.ok()).toBe(false);
  return {
    status: response.status(),
    body: await response.json(),
  };
}

export async function getReviewStatus(
  request: APIRequestContext,
  sessionCode: string
) {
  const response = await request.get(
    `${getApiBaseUrl()}/review/status?session=${encodeURIComponent(sessionCode)}`
  );
  await expect(response).toBeOK();
  return await response.json();
}

export async function getReviewSession(sessionCode: string) {
  return await getConvexClient().query("review:getSession", { sessionCode });
}
