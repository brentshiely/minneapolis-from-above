import { test } from "node:test";
import assert from "node:assert/strict";
import { CALM_MPH, compass, driftSpeed, screenVector, threadCount, windPhrase } from "../src/weather/wind.ts";
import { classify } from "../src/weather/classify.ts";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("drift speed is proportional to the wind: twice the wind, twice the pace", () => {
  assert.equal(driftSpeed(0), 0);
  assert.equal(driftSpeed(CALM_MPH - 0.5), 0, "calm: nothing moves");
  assert.equal(driftSpeed(20), 2 * driftSpeed(10));
  assert.equal(driftSpeed(5), 30);
});

test("a few threads in a breeze, more as it picks up, never a swarm", () => {
  assert.equal(threadCount(0), 0);
  assert.ok(threadCount(5) < threadCount(15));
  assert.equal(threadCount(80), 70);
});

test("screen direction: wind toward the east drifts right, toward the south drifts down", () => {
  const [ex, ey] = screenVector(90, 0);
  near(ex, 1); near(ey, 0);
  const [sx, sy] = screenVector(180, 0);
  near(sx, 0); near(sy, 1);
});

test("screen direction stays true to the compass when the map turns", () => {
  // Map rotated 90° (east at the top): an east-bound wind drifts up the screen.
  const [x, y] = screenVector(90, 90);
  near(x, 0); near(y, -1);
});

test("wind is named for where it comes from", () => {
  assert.equal(compass(315), "NW");
  assert.equal(compass(0), "N");
  assert.equal(compass(359), "N");
  assert.equal(compass(170), "S");
  assert.equal(windPhrase(315, 12, null), "NW wind 12 mph");
  assert.equal(windPhrase(225, 18, 31), "SW wind 18 mph, gusting to 31");
  assert.equal(windPhrase(225, 18, 20), "SW wind 18 mph", "gusts only mentioned when they matter");
  assert.equal(windPhrase(null, 1, null), "calm");
});

test("NWS observations: km/h to mph, direction from, gusts", () => {
  const w = classify({ windSpeed: { value: 29 }, windDirection: { value: 320 }, windGust: { value: 48 }, cloudLayers: [{ amount: "FEW" }] });
  assert.equal(w.windMph, 18);
  assert.equal(w.gustMph, 30);
  assert.equal(w.windToward, 140);
  assert.equal(w.wind, "NW wind 18 mph, gusting to 30");
});
