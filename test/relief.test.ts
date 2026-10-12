import { test } from "node:test";
import assert from "node:assert/strict";
import { reliefBrightnessMax, reliefHandOff, reliefOpacity, reliefZoomFactor } from "../src/relief.ts";

test("reliefZoomFactor is off for the whole-metro view and full once the land's shape is readable", () => {
  assert.equal(reliefZoomFactor(8), 0);
  assert.equal(reliefZoomFactor(12), 1);
  assert.ok(reliefZoomFactor(10.5) > 0 && reliefZoomFactor(10.5) < 1);
});

test("the aerial photo takes over from the shading by day, never at night", () => {
  assert.equal(reliefHandOff(1, 12), 1, "day but far: shading stays");
  assert.equal(reliefHandOff(1, 17), 0, "day and close: photo only");
  assert.equal(reliefHandOff(0, 17), 1, "night: no photo, shading stays");
});

test("reliefOpacity is hidden zoomed out and stays on up close at night", () => {
  assert.equal(reliefOpacity(0, 8), 0);
  assert.ok(reliefOpacity(0, 17) > 0);
  assert.equal(reliefOpacity(1, 17), 0);
});

test("night dims the grey so it does not wash out the dark map", () => {
  assert.ok(reliefBrightnessMax(0) < reliefBrightnessMax(1));
  assert.equal(reliefBrightnessMax(1), 1);
});
