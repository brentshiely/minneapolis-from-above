import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFalls, flowLevel, shimmerStrength } from "../src/water/falls.ts";
import type { Gauge } from "../src/water/gauges.ts";

test("classifies Minnehaha Creek's flow", () => {
  assert.equal(flowLevel(0.5), "dry");
  assert.equal(flowLevel(2.9), "trickle");
  assert.equal(flowLevel(20), "gentle");
  assert.equal(flowLevel(80), "flowing");
  assert.equal(flowLevel(300), "roaring");
});

test("shimmer only kicks in once there's real flow", () => {
  assert.equal(shimmerStrength("dry"), 0);
  assert.equal(shimmerStrength("trickle"), 0);
  assert.ok(shimmerStrength("gentle") > 0 && shimmerStrength("gentle") < shimmerStrength("flowing"));
  assert.equal(shimmerStrength("roaring"), 1);
});

const gauge = (flowKcfs: number | null, t = 1_000_000): Gauge => ({
  lid: "MHAM5", name: "Minnehaha Creek at Minneapolis / Hiawatha Ave.", body: "Minnehaha Creek",
  lat: 44.9156, lon: -93.2125, stage: 11.8, flowKcfs, category: "not_defined", t,
});

test("describes the falls in plain language", () => {
  const d = describeFalls(gauge(0.0029), 1_000_060);
  assert.equal(d.title, "Minnehaha Falls.");
  assert.equal(d.detail, "A trickle: 3 cubic feet a second.");
  assert.equal(d.meta, "Minnehaha Creek at Hiawatha Ave · updated a minute ago");

  assert.equal(describeFalls(gauge(0.18), 1_000_000).detail, "Roaring: 180 cubic feet a second.");
  assert.equal(describeFalls(gauge(0.0003), 1_000_000).detail, "Essentially dry: under 1 cubic feet a second.");
});

test("no reading yet: a plain description instead of a number", () => {
  const d = describeFalls(undefined, 1_000_000);
  assert.equal(d.title, "Minnehaha Falls.");
  assert.match(d.detail!, /^A 53-foot waterfall/);
  assert.equal(d.meta, "No current flow reading");
  assert.equal(describeFalls(gauge(null), 1_000_000).meta, "No current flow reading");
});
