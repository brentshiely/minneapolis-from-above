import { test } from "node:test";
import assert from "node:assert/strict";
import { dataUrl } from "../src/dataurl.ts";

test("without build-time versions, a data file is addressed plainly", () => {
  assert.equal(dataUrl("freeways.json"), "/data/freeways.json");
});

test("with them, the address carries a hash of the file's contents, and only for files that have one", () => {
  const g = globalThis as { __DATA_VERSIONS__?: Record<string, string> };
  g.__DATA_VERSIONS__ = { "freeways.json": "abc123def4" };
  try {
    assert.equal(dataUrl("freeways.json"), "/data/freeways.json?v=abc123def4");
    assert.equal(dataUrl("unknown.json"), "/data/unknown.json");
  } finally {
    delete g.__DATA_VERSIONS__;
  }
});
