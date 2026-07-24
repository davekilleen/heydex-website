import assert from "node:assert/strict";
import test from "node:test";

import {
  isConvexProduction,
  isTestHarnessEnvironment,
} from "../convex/lib/environment.js";

test("the test harness signal fails closed for production and unset environments", () => {
  const original = process.env.CONVEX_ENV;
  try {
    process.env.CONVEX_ENV = "prod";
    assert.equal(isConvexProduction(), true);
    assert.equal(isTestHarnessEnvironment(), false);

    delete process.env.CONVEX_ENV;
    assert.equal(isConvexProduction(), false);
    assert.equal(isTestHarnessEnvironment(), false);

    process.env.CONVEX_ENV = "test";
    assert.equal(isConvexProduction(), false);
    assert.equal(isTestHarnessEnvironment(), true);
  } finally {
    if (original === undefined) {
      delete process.env.CONVEX_ENV;
    } else {
      process.env.CONVEX_ENV = original;
    }
  }
});
