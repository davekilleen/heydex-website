import assert from "node:assert/strict";
import test from "node:test";

import { generateSecureCode } from "../convex/lib/random.js";

test("generateSecureCode returns the requested length using only the alphabet", () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = generateSecureCode(alphabet, 32);

  assert.equal(code.length, 32);
  assert.match(code, /^[A-HJ-NP-Z2-9]+$/);
});

test("generateSecureCode rejects unsafe inputs", () => {
  assert.throws(() => generateSecureCode("A", 16), /alphabet/i);
  assert.throws(() => generateSecureCode("AB", 0), /length/i);
});
