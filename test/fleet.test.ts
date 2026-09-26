import { test } from "node:test";
import assert from "node:assert/strict";
import { Fleet } from "../src/live/fleet.ts";
import { parseTransit, type TransitFile } from "../src/transit/data.ts";

const file: TransitFile = {
  generated: "", feed: { version: "", start: "", end: "" },
  routes: {
    "901": { name: "Blue Line", long: "", mode: "rail", color: "#00539F", sort: 1 },
    "21": { name: "21", long: "", mode: "bus", color: "#771473", sort: 50 },
  },
  shapes: [], trips: {},
};
const transit = parseTransit(file);

test("adds, updates in place, and classifies vehicles by route mode", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "901", 44.97, -93.27, 995, 90], ["b", "t2", "21", 44.95, -93.2, 990, null]]);
  assert.equal(fleet.list().length, 2);
  assert.equal(fleet.vehicles.get("a")!.mode, "rail");
  assert.equal(fleet.vehicles.get("b")!.mode, "bus");

  const a = fleet.vehicles.get("a")!;
  fleet.update(1015, [["a", "t1", "901", 44.96, -93.26, 1010, 95]]);
  assert.equal(fleet.vehicles.get("a"), a, "same object is updated, not replaced");
  assert.equal(a.seenAt, 1015);
  // No shape for this trip, so it glides in a straight line to the new fix.
  fleet.advance(60);
  assert.deepEqual(a.position, [-93.26, 44.96]);
});

test("unknown routes fall back to bus", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["x", "", "999", 44.9, -93.1, 1000, null]]);
  assert.equal(fleet.vehicles.get("x")!.mode, "bus");
});

test("prunes vehicles not seen within the window", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "901", 44.97, -93.27, 1000, null], ["b", "t2", "21", 44.95, -93.2, 1000, null]]);
  fleet.update(1100, [["a", "t1", "901", 44.97, -93.27, 1100, null]]);
  fleet.prune(1250, 180);
  assert.deepEqual(fleet.list().map((v) => v.id), ["a"]);
});

test("new vehicles fade in rather than popping", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "901", 44.97, -93.27, 1000, null]], 10);
  fleet.advance(0, 10);
  assert.equal(fleet.vehicles.get("a")!.alpha, 0);
  fleet.advance(0.6, 10.6);
  assert.ok(Math.abs(fleet.vehicles.get("a")!.alpha - 0.5) < 1e-9);
  fleet.advance(1, 11.6);
  assert.equal(fleet.vehicles.get("a")!.alpha, 1);
});

test("vehicles unheard from for 2 minutes fade out by 3", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "901", 44.97, -93.27, 1000, null], ["b", "t2", "21", 44.95, -93.2, 1000, null]], 0);
  fleet.update(1150, [["b", "t2", "21", 44.95, -93.2, 1150, null]], 150);
  fleet.advance(0, 150);
  assert.ok(Math.abs(fleet.vehicles.get("a")!.alpha - 0.5) < 1e-9, "halfway through the fade at 150 s");
  assert.equal(fleet.vehicles.get("b")!.alpha, 1);
});

test("a teleport leaves a fading ghost and fades the vehicle back in", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "21", 44.95, -93.30, 1000, null]], 0);
  fleet.advance(5, 5);
  // 7 km east in one fix: too far to glide, so it teleports.
  fleet.update(1015, [["a", "t1", "21", 44.95, -93.21, 1015, null]], 5);
  const drawn = fleet.drawables();
  assert.equal(drawn.length, 2, "vehicle plus ghost");
  const ghost = drawn.find((d) => d !== fleet.vehicles.get("a"))!;
  assert.ok(Math.abs(ghost.position[0] - -93.30) < 1e-9, "ghost stays where the vehicle was");
  fleet.advance(0.6, 5.6);
  assert.ok(ghost.alpha > 0.4 && ghost.alpha < 0.6);
  assert.ok(fleet.vehicles.get("a")!.alpha > 0.4 && fleet.vehicles.get("a")!.alpha < 0.6);
  fleet.advance(1, 6.6);
  assert.equal(fleet.drawables().length, 1, "ghost gone");
});

test("settle jumps straight to the latest fix (reduced motion)", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["a", "t1", "21", 44.95, -93.30, 1000, null]], 0);
  fleet.update(1015, [["a", "t1", "21", 44.95, -93.29, 1015, null]], 1);
  fleet.advance(0.016, 1.016, true);
  assert.deepEqual(fleet.vehicles.get("a")!.position, [-93.29, 44.95]);
});
