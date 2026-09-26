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
  assert.deepEqual(a.position, [-93.26, 44.96]);
  assert.equal(a.seenAt, 1015);
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
