import { test } from "node:test";
import assert from "node:assert/strict";
import { Trails, TRAIL_S } from "../src/live/trails.ts";
import type { Vehicle } from "../src/live/fleet.ts";

function fakeFleet(vs: Partial<Vehicle>[]) {
  return { vehicles: new Map(vs.map((v) => [v.id!, v as Vehicle])) };
}

test("records a point a second and appends the live head", () => {
  const v: Partial<Vehicle> = { id: "a", mode: "bus", position: [-93.27, 44.97] };
  const fleet = fakeFleet([v]);
  const trails = new Trails<Vehicle>();
  for (let t = 0; t <= 10; t += 0.25) {
    v.position = [-93.27 + t * 0.0001, 44.97];
    trails.record(fleet.vehicles, t);
  }
  const [trail] = trails.snapshot(10.1);
  assert.equal(trail.times.length, 12, "11 samples plus the head");
  assert.deepEqual(trail.path.at(-1), v.position);
  assert.equal(trail.times.at(-1), 10.1);
});

test("forgets points older than the trail length", () => {
  const v: Partial<Vehicle> = { id: "a", mode: "bus", position: [-93.27, 44.97] };
  const fleet = fakeFleet([v]);
  const trails = new Trails<Vehicle>();
  for (let t = 0; t <= TRAIL_S + 60; t += 1) trails.record(fleet.vehicles, t);
  const [trail] = trails.snapshot(TRAIL_S + 60);
  assert.ok(trail.times[0] >= 60 - 1e-9, `oldest point at ${trail.times[0]}`);
});

test("a teleport restarts the trail instead of drawing a streak", () => {
  const v: Partial<Vehicle> = { id: "a", mode: "bus", position: [-93.27, 44.97] };
  const fleet = fakeFleet([v]);
  const trails = new Trails<Vehicle>();
  for (let t = 0; t < 5; t++) trails.record(fleet.vehicles, t);
  v.position = [-93.2, 44.97]; // ~5.5 km east
  assert.equal(trails.snapshot(5).length, 0, "no trail drawn mid-teleport");
  trails.record(fleet.vehicles, 5);
  const [trail] = trails.snapshot(5.5);
  assert.equal(trail.path.length, 2, "fresh trail: one sample plus head");
});

test("drops trails for vehicles that left the fleet", () => {
  const fleet = fakeFleet([{ id: "a", mode: "bus", position: [-93.27, 44.97] }]);
  const trails = new Trails<Vehicle>();
  trails.record(fleet.vehicles, 0);
  fleet.vehicles.clear();
  trails.record(fleet.vehicles, 1);
  assert.equal(trails.snapshot(1).length, 0);
});
