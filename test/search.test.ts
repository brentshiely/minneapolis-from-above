import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuery, step } from "../src/search.ts";

test("normalizeQuery collapses whitespace and case so equal searches share a cache entry", () => {
  assert.equal(normalizeQuery("  Lake   St  &  Hennepin Ave "), "lake st & hennepin ave");
  assert.equal(normalizeQuery("MALL OF AMERICA"), "mall of america");
  assert.equal(normalizeQuery(""), "");
});

test("step moves through the results and wraps at both ends", () => {
  assert.equal(step(-1, 4, 1), 0, "first Down highlights the first result");
  assert.equal(step(-1, 4, -1), 3, "first Up highlights the last");
  assert.equal(step(3, 4, 1), 0);
  assert.equal(step(0, 4, -1), 3);
  assert.equal(step(1, 4, 1), 2);
  assert.equal(step(-1, 0, 1), -1, "nothing to move through");
});
