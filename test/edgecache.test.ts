import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, edgeCached, type CacheLike } from "../functions/_lib/edgecache.ts";

const fakeCache = () => {
  const m = new Map<string, Response>();
  const cache: CacheLike = {
    async match(k) { return m.get(k)?.clone(); },
    async put(k, r) { m.set(k, r); },
  };
  return { cache, m };
};
const ctx = (url: string, next: () => Promise<Response>, method = "GET") => ({ request: new Request(url, { method }), next });
const ok = (n: number, cc = "public, max-age=10") => () => Promise.resolve(new Response(JSON.stringify({ n }), { headers: { "cache-control": cc, "content-type": "application/json" } }));

test("cache key keeps only an endpoint's own parameters", () => {
  assert.equal(cacheKey(new URL("https://x/api/vehicles?cb=123")), "https://edge.internal/api/vehicles");
  assert.equal(cacheKey(new URL("https://x/api/water?zz=1&lid=STPM5")), "https://edge.internal/api/water?lid=STPM5");
  assert.equal(cacheKey(new URL("https://x/api/radar-tile?y=2&x=1&m=05&z=8&junk=1")), "https://edge.internal/api/radar-tile?m=05&x=1&y=2&z=8");
});

test("a second request within the TTL never reaches the handler", async () => {
  const { cache } = fakeCache();
  let runs = 0;
  const next = () => { runs++; return ok(runs)(); };
  const a = await edgeCached(ctx("https://x/api/vehicles", next), cache);
  const b = await edgeCached(ctx("https://x/api/vehicles?bust=1", next), cache);
  assert.equal(runs, 1);
  assert.equal(a.headers.get("x-edge-cache"), "MISS");
  assert.equal(b.headers.get("x-edge-cache"), "HIT");
  assert.deepEqual(await b.json(), { n: 1 });
  assert.match(b.headers.get("cache-control")!, /^public, max-age=(9|10)$/);
});

test("concurrent misses share one handler run", async () => {
  const { cache } = fakeCache();
  let runs = 0;
  const next = async () => { runs++; await new Promise((r) => setTimeout(r, 20)); return ok(runs)(); };
  const all = await Promise.all(Array.from({ length: 50 }, () => edgeCached(ctx("https://x/api/air", next), cache)));
  assert.equal(runs, 1);
  for (const r of all) assert.deepEqual(await r.json(), { n: 1 });
});

test("errors and no-store answers are passed through, never cached", async () => {
  const { cache, m } = fakeCache();
  const bad = await edgeCached(ctx("https://x/api/air", () => Promise.resolve(new Response("nope", { status: 502, headers: { "cache-control": "no-store" } }))), cache);
  assert.equal(bad.status, 502);
  assert.equal(await bad.text(), "nope");
  assert.equal(m.size, 0);
  const ns = await edgeCached(ctx("https://x/api/air", ok(1, "no-store")), cache);
  assert.equal(ns.headers.get("cache-control"), "no-store");
  assert.equal(m.size, 0);
});

test("a stale copy answers when the handler fails", async () => {
  const { cache } = fakeCache();
  const realNow = Date.now;
  try {
    await edgeCached(ctx("https://x/api/air", ok(7, "public, max-age=10")), cache);
    const t = realNow();
    Date.now = () => t + 120_000;
    const res = await edgeCached(ctx("https://x/api/air", () => Promise.resolve(new Response("x", { status: 502 }))), cache);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-edge-cache"), "STALE-ERROR");
    assert.deepEqual(await res.json(), { n: 7 });
  } finally { Date.now = realNow; }
});

test("no Cache API (local dev) or a non-GET goes straight to the handler", async () => {
  let runs = 0;
  const next = () => { runs++; return ok(runs)(); };
  await edgeCached(ctx("https://x/api/air", next), undefined);
  await edgeCached(ctx("https://x/api/air", next, "POST"), fakeCache().cache);
  assert.equal(runs, 2);
});
