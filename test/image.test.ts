import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, upstreamFor } from "../functions/api/image.ts";
import { photoUrl } from "../src/wildlife/sightings.ts";
import { cacheKey } from "../functions/_lib/edgecache.ts";

const req = (qs: string) => ({ request: new Request(`https://example.com/api/image${qs}`) });
const withFetch = async (fake: typeof fetch, fn: () => Promise<void>) => {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { await fn(); } finally { globalThis.fetch = real; }
};
const noFetch = (() => { throw new Error("must not fetch"); }) as unknown as typeof fetch;

test("only a camera id or an iNaturalist photo id is ever fetched, never a caller's URL", async () => {
  await withFetch(noFetch, async () => {
    for (const qs of [
      "", "?cam=", "?cam=../etc/passwd", "?cam=a/b", "?cam=C909%0d%0aX:1", "?cam=" + "a".repeat(81),
      "?cam=http://evil.example/x", "?cam=C909&photo=1/medium.jpg",
      "?photo=http://evil.example/x.jpg", "?photo=1/../../x.jpg", "?photo=abc/medium.jpg", "?photo=12/medium.gif", "?photo=12/original.jpg",
      "?url=https://evil.example/", "?u=https://evil.example/",
    ]) assert.equal((await onRequestGet(req(qs))).status, 400, qs);
  });
});

test("builds the fixed upstream address for each kind", () => {
  assert.equal(upstreamFor(new URLSearchParams("cam=D6-C340"))?.url, "https://public.carsprogram.org/cameras/MN/D6-C340");
  assert.equal(upstreamFor(new URLSearchParams("photo=741695852/medium.jpg"))?.url, "https://inaturalist-open-data.s3.amazonaws.com/photos/741695852/medium.jpg");
});

test("serves a picture with safe headers and a short life for cameras", async () => {
  let asked = "";
  await withFetch((async (u: string) => { asked = String(u); return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg; charset=x" } }); }) as unknown as typeof fetch, async () => {
    const res = await onRequestGet(req("?cam=C909&t=99"));
    assert.equal(asked, "https://public.carsprogram.org/cameras/MN/C909");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/jpeg");
    assert.equal(res.headers.get("cache-control"), "public, max-age=10");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.match(res.headers.get("content-security-policy")!, /sandbox/);
  });
});

test("refuses anything that is not a small picture", async () => {
  await withFetch((async () => new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch, async () => {
    assert.equal((await onRequestGet(req("?cam=C909"))).status, 502);
  });
  await withFetch((async () => new Response(new Uint8Array(10), { headers: { "content-type": "image/png", "content-length": "9000000" } })) as unknown as typeof fetch, async () => {
    assert.equal((await onRequestGet(req("?photo=1/medium.png"))).status, 502);
  });
  await withFetch((async () => new Response("", { status: 404 })) as unknown as typeof fetch, async () => {
    assert.equal((await onRequestGet(req("?cam=NOPE"))).status, 404);
  });
  await withFetch((async () => { throw new Error("down"); }) as unknown as typeof fetch, async () => {
    assert.equal((await onRequestGet(req("?cam=C909"))).status, 502);
  });
});

test("sighting photos go through our server; anything else gets no picture", () => {
  assert.equal(photoUrl("https://inaturalist-open-data.s3.amazonaws.com/photos/741695852/medium.jpg"), "/api/image?photo=741695852/medium.jpg");
  assert.equal(photoUrl("https://evil.example/photos/1/medium.jpg"), undefined);
  assert.equal(photoUrl("https://inaturalist-open-data.s3.amazonaws.com/photos/1/medium.jpg?x=1"), undefined);
  assert.equal(photoUrl(undefined), undefined);
});

test("the edge cache keys cameras and photos by id, ignoring the cache-buster", () => {
  assert.equal(cacheKey(new URL("https://x/api/image?cam=C909&t=5")), "https://edge.internal/api/image?cam=C909");
  assert.equal(cacheKey(new URL("https://x/api/image?photo=1/medium.jpg")), "https://edge.internal/api/image?photo=1/medium.jpg");
});
