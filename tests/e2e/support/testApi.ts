import { APIRequestContext, Page, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { getEnv } from "./env";

export type Visibility = "private" | "colleagues" | "public";

export type DiffSeed = {
  diffId: string;
  name: string;
  description: string;
  methodology: string;
  tags: string[];
  roles: string[];
  integrations: string[];
  adoptionCount?: number;
};

export type ReviewSeedOptions = {
  handle?: string;
  email?: string;
  domain?: string;
  displayName?: string;
  title?: string;
  function_?: string;
  company?: string;
  summary?: string;
  linkedinUrl?: string;
  photoUrl?: string;
  integrations?: string[];
  visibility?: Visibility;
  expired?: boolean;
  redeemed?: boolean;
};

export type BrowserAuthState = {
  handle: string;
  token: string;
  refreshToken: string;
  email?: string;
  domain?: string;
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

function getAuthStorageSuffix() {
  return getConvexUrl().replace(/[^a-zA-Z0-9]/g, "");
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
    diffs?: DiffSeed[];
  } = {}
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-public-profile`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function bootstrapAuthState(
  request: APIRequestContext,
  options: ReviewSeedOptions = {}
): Promise<BrowserAuthState> {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-auth`, {
    headers: getTestSecretHeader(),
    data: options,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function installAuthState(page: Page, authState: BrowserAuthState) {
  const storageSuffix = getAuthStorageSuffix();
  await page.addInitScript(
    ({ suffix, token, refreshToken }) => {
      window.localStorage.setItem(`__convexAuthJWT_${suffix}`, token);
      window.localStorage.setItem(
        `__convexAuthRefreshToken_${suffix}`,
        refreshToken
      );
    },
    {
      suffix: storageSuffix,
      token: authState.token,
      refreshToken: authState.refreshToken,
    }
  );
}

export async function bootstrapCompanyDomain(
  request: APIRequestContext,
  args: {
    domain: string;
    company?: string;
    members: Array<
      ReviewSeedOptions & {
        handle: string;
        visibility: Visibility;
        diffs?: DiffSeed[];
      }
    >;
  }
) {
  const response = await request.post(`${getApiBaseUrl()}/test/bootstrap-company-domain`, {
    headers: getTestSecretHeader(),
    data: args,
  });
  await expect(response).toBeOK();
  return await response.json();
}

export async function getCompanyForHandle(
  request: APIRequestContext,
  handle: string
) {
  const response = await request.get(
    `${getApiBaseUrl()}/test/company?handle=${encodeURIComponent(handle)}`,
    { headers: getTestSecretHeader() }
  );
  await expect(response).toBeOK();
  return await response.json();
}

export async function getPublishedDiffsForHandle(
  request: APIRequestContext,
  handle: string
) {
  const response = await request.get(
    `${getApiBaseUrl()}/test/diffs?handle=${encodeURIComponent(handle)}`,
    { headers: getTestSecretHeader() }
  );
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
    diffs: DiffSeed[];
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

export async function checkHandle(handle: string) {
  return await getConvexClient().query("users:checkHandle", { handle });
}

export async function publishReviewSession(sessionCode: string) {
  return await getConvexClient().mutation("review:publishFromSession", {
    sessionCode,
  });
}

export async function updateReviewVisibility(
  sessionCode: string,
  visibility: Visibility
) {
  return await getConvexClient().mutation("review:updateVisibility", {
    sessionCode,
    visibility,
  });
}

export async function setVisibilityAsUser(
  authState: BrowserAuthState,
  visibility: Visibility
) {
  const client = new ConvexHttpClient(getConvexUrl(), { auth: authState.token });
  return await client.mutation("users:setVisibility", { visibility });
}

export async function registerAsUser(
  authState: BrowserAuthState,
  args: {
    displayName: string;
    handle: string;
  }
) {
  const client = new ConvexHttpClient(getConvexUrl(), { auth: authState.token });
  return await client.mutation("users:register", args);
}
