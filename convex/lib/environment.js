export function isConvexProduction() {
  return process.env.CONVEX_ENV?.trim().toLowerCase() === "prod";
}

export function isTestHarnessEnvironment() {
  return process.env.CONVEX_ENV?.trim().toLowerCase() === "test";
}
