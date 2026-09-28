import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShape } from "../src/transit/data.ts";
import { CarFlow } from "../src/traffic/cars.ts";
import type { Freeways } from "../src/traffic/freeways.ts";
import type { Readings } from "../src/traffic/traffic.ts";

function withFixedRandom<T>(value: number, fn: () => T): T {
  const real = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = real; }
}

function oneStretchFreeways(): Freeways {
  return {
    stations: { S1: { label: "", limit: 55, route: "I-94", dir: "EB" } },
    stretches: [{ station: "S1", path: [[-93.30, 44.90], [-93.28, 44.90]] }],
  };
}

test("spawns nothing on a stretch with no reading", () => {
  const flow = new CarFlow(oneStretchFreeways());
  for (let i = 0; i < 50; i++) flow.advance(1, {});
  assert.deepEqual(flow.list(), []);
});

test("spawns a dot once its stretch's countdown elapses, at a rate scaled down from the real flow", () => {
  // A fixed draw makes the exponential interarrival time deterministic: -ln(1-0.5)/rate.
  withFixedRandom(0.5, () => {
    // rate = flow/3600/220 = 1/s here, so the interval is -ln(0.5) ≈ 0.693s.
    const readings: Readings = { S1: [60, 3600 * 220] };
    const flow = new CarFlow(oneStretchFreeways());
    flow.advance(0.5, readings);
    assert.deepEqual(flow.list(), [], "not due yet");
    flow.advance(0.3, readings);
    assert.equal(flow.list().length, 1, "due by 0.8s");
  });
});

test("a spawned dot glides at the stretch's real speed", () => {
  withFixedRandom(0.5, () => {
    const readings: Readings = { S1: [60, 3600 * 220] };
    const fw = oneStretchFreeways();
    const shape = buildShape("x", "S1", fw.stretches[0].path);
    const flow = new CarFlow(fw);
    flow.advance(1, readings); // spawns at dist 0
    const [before] = flow.list();
    flow.advance(1, {}); // no reading needed to keep an existing car gliding
    const [after] = flow.list();
    const movedM = Math.hypot(...[0, 1].map((i) => (after.position[i] - before.position[i]) * (i === 0 ? 111_320 * Math.cos(44.9 * Math.PI / 180) : 111_320)));
    const expectedMs = 60 * 0.44704;
    assert.ok(Math.abs(movedM - expectedMs) < 0.5, `moved ${movedM}m, expected ~${expectedMs}m in 1s`);
    assert.ok(movedM < shape.length, "still short of the end of this short stretch");
  });
});

test("a dot disappears once it glides past the end of its stretch", () => {
  withFixedRandom(0.5, () => {
    const readings: Readings = { S1: [60, 3600 * 220] };
    const flow = new CarFlow(oneStretchFreeways());
    flow.advance(1, readings);
    assert.equal(flow.list().length, 1);
    for (let i = 0; i < 200; i++) flow.advance(1, readings === undefined ? {} : {}); // let it run off the far end
    assert.deepEqual(flow.list(), [], "gone once its dist passes the stretch's length");
  });
});

test("never more than a couple of dots pile up on one stretch, however heavy the flow", () => {
  withFixedRandom(0.999, () => {
    // A tiny random draw makes the countdown collapse to ~0 almost every tick.
    const readings: Readings = { S1: [5, 3600 * 220 * 50] };
    const flow = new CarFlow(oneStretchFreeways());
    for (let i = 0; i < 20; i++) flow.advance(0.1, readings);
    assert.ok(flow.list().length <= 2, `${flow.list().length} dots on one stretch`);
  });
});

test("no speed or no flow reading means no spawns from that stretch", () => {
  const flow = new CarFlow(oneStretchFreeways());
  flow.advance(1, { S1: [null, 900] });
  assert.deepEqual(flow.list(), []);
  flow.advance(1, { S1: [60, null] });
  assert.deepEqual(flow.list(), []);
  flow.advance(1, { S1: [60, 0] });
  assert.deepEqual(flow.list(), []);
});
