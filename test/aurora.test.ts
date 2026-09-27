import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, toResponse } from "../functions/api/aurora.ts";
import { auroraPhrase, auroraStrength, previewAurora, tonightKp } from "../src/sky/aurora.ts";

// --- server: parsing ---------------------------------------------------------

test("toResponse parses NOAA's rows and flags predictions", () => {
  const body = toResponse([
    { time_tag: "2026-01-01T00:00:00", kp: 2.33, observed: "observed" },
    { time_tag: "2026-01-01T03:00:00", kp: 6, observed: "predicted" },
  ]);
  assert.equal(body.kp.length, 2);
  assert.equal(body.kp[0][1], 2.33);
  assert.equal(body.kp[0][2], false);
  assert.equal(body.kp[1][1], 6);
  assert.equal(body.kp[1][2], true);
});

test("toResponse skips rows that don't parse and keeps only the most recent", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ time_tag: `2026-01-01T${String(i % 24).padStart(2, "0")}:00:00`, kp: i, observed: "observed" }));
  const body = toResponse([{ time_tag: undefined, kp: 5, observed: "observed" }, ...rows, { time_tag: "2026-01-01T00:00:00", kp: undefined as unknown as number, observed: "observed" }]);
  assert.equal(body.kp.length, 24);
  assert.equal(body.kp.at(-1)![1], 29);
});

test("handler returns JSON with a cache header, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify([{ time_tag: "2026-01-01T00:00:00", kp: 3, observed: "observed" }]))) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=600/);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: strength, tonight's window, phrasing ----------------------------

test("auroraStrength is zero below the visible threshold and maxes out by Kp 8.5", () => {
  assert.equal(auroraStrength(3), 0);
  assert.equal(auroraStrength(5), 0);
  assert.ok(auroraStrength(6) > 0 && auroraStrength(6) < 1);
  assert.ok(auroraStrength(7) > auroraStrength(6));
  assert.equal(auroraStrength(8.5), 1);
  assert.equal(auroraStrength(9), 1);
});

test("tonightKp finds the highest Kp in the coming overnight window, from an evening check", () => {
  // 8 PM Minneapolis time (America/Chicago, CDT = UTC-5 in late September).
  const evening = Date.UTC(2026, 8, 27, 1, 0, 0) / 1000; // 2026-09-27 01:00Z = 20:00 CDT the 26th
  const rows: [number, number, boolean][] = [
    [evening - 3600, 2, false], // just before now: outside the window
    [evening + 3600, 7, true],  // tonight
    [evening + 6 * 3600, 3, true],
    [evening + 30 * 3600, 9, true], // two nights out: outside this window
  ];
  assert.equal(tonightKp(rows, evening), 7);
});

test("auroraPhrase is quiet below threshold and reads well above it", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(auroraPhrase([[now, 3, false]], now), undefined);
  assert.equal(auroraPhrase([[now, 6, false]], now), "Northern lights possible tonight");
});

test("previewAurora serves known levels and nothing for an unknown spec", () => {
  const watch = previewAurora("watch");
  assert.ok(watch);
  assert.equal(watch!.kp[0][1], 6);
  assert.equal(previewAurora("not-a-real-level"), undefined);
  assert.equal(previewAurora(""), undefined);
});
