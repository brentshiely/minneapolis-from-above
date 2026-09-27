import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheBust, radarTileUrl } from "../src/weather/radar.ts";

test("radarTileUrl asks our proxy for the 5-minutes-ago frame, zero-padded", () => {
  assert.match(radarTileUrl(1), /^\/api\/radar-tile\?m=05&/);
  assert.match(radarTileUrl(1), /z=\{z\}&x=\{x\}&y=\{y\}/);
});

test("radarTileUrl's cache-bust value changes what's requested", () => {
  assert.notEqual(radarTileUrl(1), radarTileUrl(2));
});

test("cacheBust groups timestamps into 5-minute buckets", () => {
  const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
  assert.equal(cacheBust(t0), cacheBust(t0 + 4 * 60_000));
  assert.notEqual(cacheBust(t0), cacheBust(t0 + 5 * 60_000));
});
