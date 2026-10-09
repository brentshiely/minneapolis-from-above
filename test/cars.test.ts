import { test } from "node:test";
import assert from "node:assert/strict";
import { CarFlow, vehiclesPerSecond } from "../src/traffic/cars.ts";
import type { Freeways } from "../src/traffic/freeways.ts";
import type { Readings } from "../src/traffic/traffic.ts";

const M_PER_DEG_LON = 111_320 * Math.cos((44.9 * Math.PI) / 180);

/** One station, one stretch about `lengthM` meters long running due east. */
function oneStretchFreeways(lanes = 3, lengthM = 1000): Freeways {
  return {
    stations: { S1: { label: "", limit: 55, lanes, route: "I-94", dir: "EB" } },
    stretches: [{ station: "S1", path: [[-93.3, 44.9], [-93.3 + lengthM / M_PER_DEG_LON, 44.9]] }],
  };
}

test("vehicles per second is per-lane flow times lanes over 3600", () => {
  assert.equal(vehiclesPerSecond(1200, 3), 1);
  assert.equal(vehiclesPerSecond(1800, 2), 1);
  assert.equal(vehiclesPerSecond(900, 0), 0.5, "an unknown lane count assumes two");
});

test("spawns nothing on a stretch with no reading", () => {
  const flow = new CarFlow(oneStretchFreeways());
  for (let i = 0; i < 50; i++) flow.advance(1, {});
  assert.equal(flow.count, 0);
});

test("no speed or no flow reading means no cars on that stretch", () => {
  const flow = new CarFlow(oneStretchFreeways());
  flow.advance(1, { S1: [null, 900] });
  assert.equal(flow.count, 0);
  flow.advance(1, { S1: [60, null] });
  assert.equal(flow.count, 0);
  flow.advance(1, { S1: [60, 0] });
  assert.equal(flow.count, 0);
});

function withFixedRandom<T>(value: number, fn: () => T): T {
  const real = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = real; }
}

/** Cars that entered during a run, told apart from the seeded ones (parked mid-stretch by the fixed draw). */
function enteredIn(lanes: number, flowPerLane: number, seconds: number): number {
  return withFixedRandom(0.5, () => {
    const lengthM = 20_000;
    const flow = new CarFlow(oneStretchFreeways(lanes, lengthM));
    const readings: Readings = { S1: [30, flowPerLane] };
    flow.advance(0.001, readings);
    for (let i = 0; i < seconds * 10; i++) flow.advance(0.1, readings);
    let entered = 0;
    for (let i = 0; i < flow.count; i++) if ((flow.positions[2 * i] + 93.3) * M_PER_DEG_LON < lengthM / 4) entered++;
    return entered;
  });
}

test("cars enter at the real rate: 1,200 veh/hr/lane on 3 lanes is a car a second", () => {
  // A fixed draw makes each gap exactly ln(2)/rate = 0.693 s at 1 car/s: 86 cars in a minute.
  const n = enteredIn(3, 1200, 60);
  assert.ok(Math.abs(n - 86) <= 2, `${n} cars entered in a minute, expected ~86`);
});

test("twice the lanes at the same per-lane flow is twice the cars", () => {
  const three = enteredIn(3, 1200, 60), six = enteredIn(6, 1200, 60);
  assert.ok(Math.abs(six - 2 * three) <= 4, `${six} vs ${three}`);
});

test("the stretch starts out populated at flow x length / speed, not empty", () => {
  // 3,600 veh/hr (1/s) at 20 m/s over 2 km: about 100 cars already on the road.
  const speedMph = 20 / 0.44704;
  const flow = new CarFlow(oneStretchFreeways(3, 2000));
  flow.advance(0.01, { S1: [speedMph, 1200] });
  assert.ok(flow.count > 60 && flow.count < 140, `${flow.count} cars seeded, expected ~100`);
});

test("congestion packs cars tighter: same flow, slower speed, more cars", () => {
  const fast = new CarFlow(oneStretchFreeways(3, 2000));
  const slow = new CarFlow(oneStretchFreeways(3, 2000));
  fast.advance(0.01, { S1: [60, 1000] });
  slow.advance(0.01, { S1: [10, 1000] });
  assert.ok(slow.count > fast.count * 3, `${slow.count} slow vs ${fast.count} fast`);
});

test("cars glide at the stretch's real speed", () => {
  withFixedRandom(0.5, () => {
    const flow = new CarFlow(oneStretchFreeways(3, 20_000));
    flow.advance(0.001, { S1: [60, 1200] }); // seeds every car at the midpoint, speed untouched by jitter
    const before = flow.positions[0];
    flow.advance(1, {}); // existing cars need no reading to keep gliding
    const movedM = (flow.positions[0] - before) * M_PER_DEG_LON;
    const expectedMs = 60 * 0.44704;
    assert.ok(Math.abs(movedM - expectedMs) < 0.5, `moved ${movedM}m, expected ~${expectedMs}m in 1s`);
  });
});

test("a car disappears once it glides past the end of its stretch", () => {
  const flow = new CarFlow(oneStretchFreeways(3, 500));
  flow.advance(0.01, { S1: [60, 1200] });
  assert.ok(flow.count > 0);
  for (let i = 0; i < 100; i++) flow.advance(1, {});
  assert.equal(flow.count, 0, "all gone once past the stretch's length");
});

test("a long pause doesn't spawn a flood", () => {
  const flow = new CarFlow(oneStretchFreeways(3, 20_000));
  const readings: Readings = { S1: [60, 1200] };
  flow.advance(0.01, readings);
  const before = flow.count;
  flow.advance(3600, readings);
  assert.ok(flow.count - before < 10, `${flow.count - before} spawned in one clamped step`);
});
