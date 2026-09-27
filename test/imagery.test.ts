import { test } from "node:test";
import assert from "node:assert/strict";
import { imageryOpacity, zoomFactor } from "../src/imagery.ts";

test("zoomFactor is off zoomed out, ramps to fully on once close enough to read a photo", () => {
  assert.equal(zoomFactor(8.5), 0);
  assert.equal(zoomFactor(14), 0);
  assert.equal(zoomFactor(15), 0.5);
  assert.equal(zoomFactor(16), 1);
  assert.equal(zoomFactor(18.5), 1);
});

test("imageryOpacity needs both daylight and closeness: either alone keeps it hidden", () => {
  assert.equal(imageryOpacity(1, 8.5), 0, "daylight but zoomed out");
  assert.equal(imageryOpacity(0, 18), 0, "close but night");
  assert.equal(imageryOpacity(1, 18), 1, "day and close: fully shown");
  assert.equal(imageryOpacity(0.5, 16), 0.5, "blue hour scales it down");
});
