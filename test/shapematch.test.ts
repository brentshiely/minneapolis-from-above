import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShape, M_PER_DEG_LAT, type Transit } from "../src/transit/data.ts";
import type { LonLat } from "../src/live/geometry.ts";
import { Fleet } from "../src/live/fleet.ts";
import { Motion } from "../src/live/motion.ts";
import { angleBetween, inferShape } from "../src/live/shapematch.ts";

const ORIGIN: LonLat = [-93.27, 44.97];
const KX = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (e: number, n: number): LonLat => [ORIGIN[0] + e / KX, ORIGIN[1] + n / M_PER_DEG_LAT];

// Route 21 runs east on one street and back west on the same street (two shapes, one line).
const EAST = buildShape("e", "21", [at(0, 0), at(2000, 0)], "East", "EB");
const WEST = buildShape("w", "21", [at(2000, 0), at(0, 0)], "West", "WB");
// A different route on a street a block north.
const OTHER = buildShape("o", "5", [at(0, 300), at(2000, 300)], "East", "EB");

const transit = {
  file: {} as Transit["file"],
  routes: { "21": { name: "21", long: "", mode: "bus", color: "", sort: 1 }, "5": { name: "5", long: "", mode: "bus", color: "", sort: 2 } },
  shapes: [EAST, WEST, OTHER],
  shapeForTrip: (id: string | undefined) => (id === "known" ? EAST : undefined),
} as Transit;

test("angleBetween wraps around north", () => {
  assert.equal(angleBetween(350, 10), 20);
  assert.equal(angleBetween(90, 270), 180);
  assert.equal(angleBetween(0, 0), 0);
});

test("a bus with an unknown trip is matched to its route's line by position", () => {
  assert.equal(inferShape(transit, "5", at(800, 305)), OTHER);
});

test("it never matches a line of another route, or one the bus isn't on", () => {
  assert.equal(inferShape(transit, "5", at(800, 0)), undefined, "route 5's line is 300 m north");
  assert.equal(inferShape(transit, "21", at(800, 150)), undefined, "150 m from both of route 21's shapes");
  assert.equal(inferShape(transit, "nope", at(800, 0)), undefined);
});

test("on a street both directions share, the bearing picks the direction", () => {
  assert.equal(inferShape(transit, "21", at(800, 2), { bearing: 90 }), EAST);
  assert.equal(inferShape(transit, "21", at(800, 2), { bearing: 270 }), WEST);
});

test("with two equally near directions and no bearing, it declines to guess", () => {
  assert.equal(inferShape(transit, "21", at(800, 2)), undefined);
});

test("a bus already on a shape stays on it", () => {
  assert.equal(inferShape(transit, "21", at(800, 2), { bearing: 270, current: EAST }), EAST);
  // ...until it leaves that line.
  assert.notEqual(inferShape(transit, "21", at(800, 2), { bearing: 270, current: OTHER }), OTHER);
});

test("the fleet puts a bus with an unknown trip on its route's line and faces it along the street", () => {
  const fleet = new Fleet(transit);
  const [lon, lat] = at(800, 3); // a few meters off the line, as GPS is
  fleet.update(1000, [["b1", "stale-trip-id", "21", lat, lon, 1000, 270]]);
  const v = fleet.vehicles.get("b1")!;
  assert.equal(v.motion.shape, WEST);
  assert.ok(angleBetween(v.motion.heading, 270) < 5);
  assert.ok(Math.abs(v.motion.pos[1] - at(800, 0)[1]) < 1e-5, "drawn on the street, not at the GPS offset");
});

test("without a feed bearing, the direction between two fixes decides", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["b1", "stale", "21", at(500, 2)[1], at(500, 2)[0], 1000, null]]);
  assert.equal(fleet.vehicles.get("b1")!.motion.shape, undefined, "no bearing yet, ambiguous: wait");
  fleet.update(1015, [["b1", "stale", "21", at(650, 2)[1], at(650, 2)[0], 1015, null]]);
  assert.equal(fleet.vehicles.get("b1")!.motion.shape, EAST, "it moved east, so it's on the eastbound line");
});

test("a trip that is in the schedule still wins over the guess", () => {
  const fleet = new Fleet(transit);
  fleet.update(1000, [["b1", "known", "21", at(800, 2)[1], at(800, 2)[0], 1000, 270]]);
  assert.equal(fleet.vehicles.get("b1")!.motion.shape, EAST);
});

test("off every line, a vehicle faces the feed's bearing, not the corner-cutting glide", () => {
  const m = new Motion(undefined, at(0, 0), 1000, 10);
  assert.equal(m.heading, 10);
  // The fix is straight east, but the bus reports it's heading north (it just turned the corner).
  m.onFix(undefined, at(200, 0), 1015, 5);
  assert.equal(m.heading, 5);
  // With no bearing in the feed, the glide's own direction is the best available.
  m.advance(30);
  m.onFix(undefined, at(400, 0), 1030, null);
  assert.ok(angleBetween(m.heading, 90) < 1);
});
