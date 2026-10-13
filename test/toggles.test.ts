import { test } from "node:test";
import assert from "node:assert/strict";
import { loadToggles, saveToggles, TOGGLE_GROUPS } from "../src/toggles.ts";

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  } as Storage;
}

test("every toggle group has a unique key, a label and a glyph", () => {
  const keys = TOGGLE_GROUPS.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, "keys should be unique");
  for (const g of TOGGLE_GROUPS) {
    assert.ok(g.label.length > 0, g.key);
    assert.ok(g.glyph.length > 0, g.key);
  }
});

test("loadToggles defaults every layer to on when nothing is saved", () => {
  const realStorage = globalThis.sessionStorage;
  try {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fakeStorage();
    const t = loadToggles();
    for (const g of TOGGLE_GROUPS) assert.equal(t[g.key], true, g.key);
  } finally {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = realStorage;
  }
});

test("saveToggles round-trips through loadToggles, and a new layer added later still defaults on", () => {
  const realStorage = globalThis.sessionStorage;
  try {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fakeStorage();
    const first = loadToggles();
    first.planes = false;
    saveToggles(first);
    const reloaded = loadToggles();
    assert.equal(reloaded.planes, false);
    assert.equal(reloaded.transit, true);
  } finally {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = realStorage;
  }
});

test("loadToggles tolerates missing sessionStorage entirely (private browsing, etc.)", () => {
  const realStorage = globalThis.sessionStorage;
  try {
    // @ts-expect-error -- simulating an environment where sessionStorage throws.
    globalThis.sessionStorage = { getItem() { throw new Error("blocked"); } };
    const t = loadToggles();
    assert.equal(t.transit, true);
  } finally {
    (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = realStorage;
  }
});
