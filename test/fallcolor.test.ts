import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, toResponse } from "../functions/api/fallcolor.ts";
import { fallColorPhrase, fallColorStrength, fallColorWord, previewFallColor } from "../src/seasons/fallcolor.ts";

function dateNDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

test("toResponse averages only fresh metro-region reports", () => {
  const body = toResponse([
    { date: dateNDaysAgo(1), region: "metro", leaves: "4" },
    { date: dateNDaysAgo(2), region: "metro", leaves: "2" },
    { date: dateNDaysAgo(1), region: "ne", leaves: "6" },
    { date: dateNDaysAgo(60), region: "metro", leaves: "1" },
  ]);
  assert.equal(body.samples, 2);
  assert.equal(body.avgLeaves, 3);
});

test("toResponse reports no signal when nothing metro is fresh (off-season)", () => {
  const body = toResponse([{ date: dateNDaysAgo(90), region: "metro", leaves: "6" }]);
  assert.equal(body.avgLeaves, undefined);
  assert.equal(body.samples, 0);
});

test("handler returns JSON with a long cache, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify([]))) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=43200/);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: strength and phrasing --------------------------------------------

test("fallColorStrength ranges 0 (no signal or green) to 1 (past peak)", () => {
  assert.equal(fallColorStrength(undefined), 0);
  assert.equal(fallColorStrength(1), 0);
  assert.equal(fallColorStrength(6), 1);
  assert.ok(fallColorStrength(3.5) > 0 && fallColorStrength(3.5) < 1);
});

test("fallColorWord reads the DNR 1-6 scale in plain words", () => {
  assert.equal(fallColorWord(1.2), "just starting");
  assert.equal(fallColorWord(3), "changing");
  assert.equal(fallColorWord(4.5), "near peak");
  assert.equal(fallColorWord(5.8), "past peak");
});

test("fallColorPhrase is quiet with no signal or barely any change, and reads plainly once there's real color", () => {
  assert.equal(fallColorPhrase({ t: 0, samples: 0 }), undefined);
  assert.equal(fallColorPhrase({ t: 0, avgLeaves: 1.5, samples: 3 }), undefined);
  assert.equal(fallColorPhrase({ t: 0, avgLeaves: 4.5, samples: 3 }), "Fall color: near peak");
});

test("previewFallColor serves each known level and nothing for an unknown spec", () => {
  for (const key of ["starting", "changing", "peak", "past"]) assert.ok(previewFallColor(key), key);
  assert.equal(previewFallColor("not-a-real-level"), undefined);
  assert.equal(previewFallColor(""), undefined);
});
