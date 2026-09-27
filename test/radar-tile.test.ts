import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet } from "../functions/api/radar-tile.ts";

const req = (qs: string) => ({ request: new Request(`https://example.com/api/radar-tile${qs}`) });

test("rejects a malformed tile request without touching the network", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => { throw new Error("should not fetch"); }) as typeof fetch;
    assert.equal((await onRequestGet(req("?m=x&z=8&x=61&y=92"))).status, 400);
    assert.equal((await onRequestGet(req("?m=05&z=8&x=61"))).status, 400);
    assert.equal((await onRequestGet(req(""))).status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("proxies a valid tile request to IEM's minutes-ago product, zero-padded", async () => {
  const realFetch = globalThis.fetch;
  try {
    let requestedUrl = "";
    globalThis.fetch = (async (url: string) => {
      requestedUrl = String(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch;
    const res = await onRequestGet(req("?m=5&z=8&x=61&y=92"));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("cache-control")!, /max-age=300/);
    assert.match(requestedUrl, /nexrad-n0q-m05m-900913\/8\/61\/92\.png$/);
    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...body], [1, 2, 3]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("passes through a clear 502 when IEM fails or errors", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet(req("?m=05&z=8&x=61&y=92"))).status, 502);
    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet(req("?m=05&z=8&x=61&y=92"))).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});
