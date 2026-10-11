import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- plain JavaScript, so the build script runs on any Node
import { angleBetween, bearing, buildGraph, dist, hasRef, offsetRight, onewayOf, refTokens, route, simplify, snapNode, snapRun, snappable, M_PER_DEG } from "../scripts/lib/roadsnap.mjs";

type P = [number, number];
const O: P = [-93.2, 44.95];
const KX = M_PER_DEG * Math.cos((O[1] * Math.PI) / 180);
/** Meters east and north of the origin. */
const at = (e: number, n: number): P => [O[0] + e / KX, O[1] + n / M_PER_DEG];

/** A way as Overpass returns it. */
function way(id: number, nodes: number[], pts: P[], tags: Record<string, string>) {
  return { type: "way", id, nodes, geometry: pts.map(([lon, lat]) => ({ lon, lat })), tags };
}

// Two carriageways of I 94, 30 m apart, running east (south side) and west (north side), curving up in the middle.
const eastPts = [at(0, 0), at(500, 0), at(1000, 100), at(1500, 100)];
const westPts = [at(1500, 130), at(1000, 130), at(500, 30), at(0, 30)];
const ways = [
  way(1, [1, 2, 3, 4], eastPts, { highway: "motorway", ref: "I 94", oneway: "yes" }),
  way(2, [14, 13, 12, 11], westPts, { highway: "motorway", ref: "I 94", oneway: "yes" }),
  way(3, [21, 22], [at(0, 500), at(1500, 500)], { highway: "motorway", ref: "I 35" , oneway: "yes" }), // another route
];
const graph = buildGraph(ways, ["I 94"]);

test("refTokens: MnDOT routes as OSM refs", () => {
  assert.deepEqual(refTokens("I-94"), ["I 94"]);
  assert.deepEqual(refTokens("I-35W"), ["I 35W"]);
  assert.deepEqual(refTokens("U.S.169"), ["US 169"]);
  assert.deepEqual(refTokens("T.H.55"), ["MN 55", "US 55"]);
  assert.deepEqual(refTokens("I-394 Rev"), ["I 394"], "express lanes name their base route");
  assert.deepEqual(refTokens("Co Rd 5"), []);
});

test("express lanes and collector roads aren't snapped", () => {
  assert.equal(snappable("I-94"), true);
  assert.equal(snappable("I-394 Rev"), false);
  assert.equal(snappable("I-35W CD"), false);
});

test("hasRef reads OSM's joined refs, however they're spelled", () => {
  assert.ok(hasRef({ ref: "I 94;US 52" }, ["US 52"]));
  assert.ok(hasRef({ ref: "I-94" }, ["I 94"]));
  assert.ok(hasRef({ ref: "mn 55" }, ["MN 55"]));
  assert.ok(!hasRef({ ref: "I 94" }, ["I 35"]));
  assert.ok(!hasRef({}, ["I 94"]));
});

test("onewayOf: tagged, reversed, two-way, and a motorway's default", () => {
  assert.equal(onewayOf({ oneway: "yes" }), 1);
  assert.equal(onewayOf({ oneway: "-1" }), -1);
  assert.equal(onewayOf({ oneway: "no", highway: "motorway" }), 0);
  assert.equal(onewayOf({ highway: "motorway" }), 1);
  assert.equal(onewayOf({ highway: "trunk" }), 0);
});

test("the graph holds only the route's own ways, directed as drawn", () => {
  assert.equal(graph.vert.size, 8, "I 35's way is left out");
  assert.deepEqual(graph.adj.get(1)!.map((e: { to: number }) => e.to), [2]);
  assert.equal(graph.adj.get(2)!.length, 1, "one way only: east");
  const reversed = buildGraph([way(9, [1, 2], [at(0, 0), at(100, 0)], { highway: "trunk", ref: "I 94", oneway: "-1" })], ["I 94"]);
  assert.deepEqual(reversed.adj.get(2)!.map((e: { to: number }) => e.to), [1], "oneway=-1 runs against the way");
});

test("a sensor goes on the carriageway heading its way, not the one beside it", () => {
  // Midway between the two carriageways (15 m from each), nowhere near a vertex.
  const p = at(250, 15);
  const eastbound = snapNode(graph, p, 90)!;
  const westbound = snapNode(graph, p, 270)!;
  assert.ok(Math.abs(dist(eastbound.point, at(250, 0))) < 0.5, "eastbound sensor lands on the south carriageway");
  assert.ok(Math.abs(dist(westbound.point, at(250, 30))) < 0.5, "westbound sensor lands on the north carriageway");
  assert.ok(Math.abs(eastbound.offset - 15) < 0.5);
});

test("a sensor with no road going its way nearby isn't snapped", () => {
  assert.equal(snapNode(graph, at(250, 15), 0), undefined, "nothing heads north");
  assert.equal(snapNode(graph, at(250, 400), 90), undefined, "too far from any road");
  assert.equal(snapNode(graph, at(250, 90), 90), undefined, "60 m away is past the cutoff for the nearest eastbound line");
});

test("route follows the curve, not the straight line, and never goes the wrong way", () => {
  const r = route(graph, 1, 4, 5000)!;
  assert.deepEqual(r.ids, [1, 2, 3, 4]);
  assert.equal(r.two, false);
  assert.equal(route(graph, 4, 1, 5000), undefined, "eastbound ways can't be driven west");
  assert.equal(route(graph, 1, 4, 100), undefined, "longer than allowed");
  assert.deepEqual(route(graph, 3, 3, 10)!.ids, [3]);
});

test("snapRun puts a westbound run's path on the westbound carriageway, through its curve", () => {
  const run = [{ p: at(1450, 128) }, { p: at(1000, 128) }, { p: at(520, 33) }, { p: at(40, 28) }];
  const out = snapRun(graph, run);
  assert.equal(out.length, 3);
  assert.ok(out.every((s: { snapped: boolean }) => s.snapped));
  // Every vertex of the path lies on the west carriageway (north side), none on the east.
  const onWest = (v: P) => westPts.slice(0, -1).some((a, i) => {
    const b = westPts[i + 1];
    const len = dist(a, b), d1 = dist(a, v), d2 = dist(v, b);
    return Math.abs(d1 + d2 - len) < 0.5;
  });
  for (const s of out) for (const v of s.path as P[]) assert.ok(onWest(v), "vertex lies on the westbound line");
  // The last interval passes through the road's own vertex at the bend (x 500) instead of cutting across it.
  assert.ok((out[2].path as P[]).some((v) => dist(v, at(500, 30)) < 0.5), "includes the road's own vertex at the bend");
  assert.equal(out[1].path.length, 2, "both sensors on the same piece of road: just the two points");
});

test("snapRun falls back to the straight line where the road can't be followed", () => {
  const run = [{ p: at(100, 3) }, { p: at(1400, 500) }, { p: at(1450, 502) }];
  const out = snapRun(graph, run);
  assert.equal(out[0].snapped, false);
  assert.deepEqual(out[0].path, [run[0].p, run[1].p]);
});

test("a single two-way line for both directions is reported as two-way", () => {
  const g = buildGraph([way(5, [1, 2, 3], [at(0, 0), at(300, 0), at(600, 0)], { highway: "trunk", ref: "MN 55" })], ["MN 55"]);
  const out = snapRun(g, [{ p: at(10, 2) }, { p: at(590, 2) }]);
  assert.equal(out[0].snapped, true);
  assert.equal(out[0].twoWay, true);
  const near = snapRun(g, [{ p: at(10, 2) }, { p: at(40, 2) }]);
  assert.equal(near[0].path.length, 2, "two sensors on the same piece of road: just the two points");
});

test("simplify drops points on a straight line and keeps the corners", () => {
  const line: P[] = [at(0, 0), at(100, 0.2), at(200, 0), at(300, 0), at(300, 200)];
  assert.deepEqual(simplify(line, 1.5), [line[0], line[3], line[4]]);
  assert.deepEqual(simplify([line[0], line[1]], 1.5), [line[0], line[1]]);
});

test("offsetRight shifts a path to the right of its travel direction", () => {
  const [a, b] = offsetRight([at(0, 0), at(100, 0)], 10) as P[];
  assert.ok(Math.abs(dist(a, at(0, -10))) < 0.1, "heading east, right is south");
  assert.ok(Math.abs(bearing(at(0, 0), at(100, 0)) - 90) < 0.01);
  assert.ok(Math.abs(b[1] - at(100, -10)[1]) < 1e-6);
  assert.equal(angleBetween(350, 10), 20);
});
