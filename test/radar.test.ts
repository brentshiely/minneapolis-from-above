import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheBust, currentFrame, FRAME_OFFSETS_MIN, radarTileUrl } from "../src/weather/radar.ts";

test("radarTileUrl asks our proxy for the right minutes-ago frame, zero-padded", () => {
  assert.match(radarTileUrl(0, 1), /^\/api\/radar-tile\?m=00&/);
  assert.match(radarTileUrl(5, 1), /[?&]m=05(&|$)/);
  assert.match(radarTileUrl(25, 1), /[?&]m=25(&|$)/);
  assert.match(radarTileUrl(5, 1), /z=\{z\}&x=\{x\}&y=\{y\}/);
});

test("radarTileUrl's cache-bust value changes what's requested", () => {
  assert.notEqual(radarTileUrl(5, 1), radarTileUrl(5, 2));
});

test("cacheBust groups timestamps into 5-minute buckets", () => {
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(cacheBust(t0), cacheBust(t0 + 4 * 60_000));
  assert.notEqual(cacheBust(t0), cacheBust(t0 + 5 * 60_000));
});

test("currentFrame steps through every offset in order, then holds on the newest before looping", () => {
  const seen: number[] = [];
  let last = -1;
  for (let t = 0; t < 20; t += 0.1) {
    const f = currentFrame(t);
    if (f !== last) { seen.push(f); last = f; }
  }
  // First full pass covers every frame index in order, oldest to newest.
  assert.deepEqual(seen.slice(0, FRAME_OFFSETS_MIN.length), FRAME_OFFSETS_MIN.map((_, i) => i));
  // It loops back to the start (index 0 again) rather than running off the end.
  assert.ok(seen.slice(FRAME_OFFSETS_MIN.length).includes(0), `never looped back to 0: ${seen}`);
});

test("currentFrame never returns an out-of-range index, even at t=0 or far in the future", () => {
  for (const t of [0, 0.001, 1000, 1_000_000]) {
    const f = currentFrame(t);
    assert.ok(f >= 0 && f < FRAME_OFFSETS_MIN.length, `frame ${f} out of range at t=${t}`);
  }
});
