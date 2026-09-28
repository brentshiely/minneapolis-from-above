import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodePolyline, distM, mergeTransitFiles, parseTransit, type TransitFile } from "../src/transit/data.ts";

const file: TransitFile = JSON.parse(readFileSync(new URL("../public/data/transit.json", import.meta.url), "utf8"));
const transit = parseTransit(file);
const dtaFile: TransitFile = JSON.parse(readFileSync(new URL("../public/data/dta-transit.json", import.meta.url), "utf8"));

test("decodes the reference polyline from Google's spec", () => {
  // Google's documented example: (38.5,-120.2), (40.7,-120.95), (43.252,-126.453)
  const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  assert.deepEqual(pts, [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test("route data covers light rail, BRT and local buses", () => {
  assert.equal(transit.routes["901"].mode, "rail");
  assert.equal(transit.routes["902"].mode, "rail");
  assert.equal(transit.routes["921"].mode, "brt");
  assert.equal(transit.routes["21"]?.mode ?? "bus", "bus");
  assert.ok(transit.shapes.length > 300, `only ${transit.shapes.length} shapes`);
});

test("every shape sits inside the metro and has a sane length", () => {
  for (const s of transit.shapes) {
    for (const [lon, lat] of s.path) {
      assert.ok(lon > -94.5 && lon < -92.3 && lat > 44.4 && lat < 45.6, `shape ${s.id} strays to ${lon},${lat}`);
    }
    assert.ok(s.length > 200 && s.length < 150_000, `shape ${s.id} is ${s.length} m`);
  }
});

test("Blue Line shape runs downtown Minneapolis to Mall of America", () => {
  const blue = transit.shapes.filter((s) => s.route === "901");
  assert.ok(blue.length > 0);
  const longest = blue.reduce((a, b) => (a.length > b.length ? a : b));
  // Roughly 19 km end to end.
  assert.ok(longest.length > 17_000 && longest.length < 22_000, `Blue Line is ${longest.length} m`);
  const ends = [longest.path[0], longest.path.at(-1)!];
  const target = distM([-93.2774, 44.9832], [-93.2410, 44.8549]); // Target Field to MOA
  assert.ok(distM(ends[0], ends[1]) > target * 0.85);
});

test("live trip IDs from the realtime feed resolve to shapes", { skip: process.env.OFFLINE ? "offline" : false }, async () => {
  const res = await fetch("https://svc.metrotransit.org/nextrip/vehicles/901");
  const vehicles: { trip_id: string }[] = await res.json();
  if (!vehicles.length) return; // no trains running (overnight)
  const resolved = vehicles.filter((v) => transit.shapeForTrip(v.trip_id));
  assert.ok(resolved.length / vehicles.length > 0.9, `${resolved.length}/${vehicles.length} trips resolved`);
});

// --- merging a second agency's baked file (Duluth Transit Authority) -------------

test("Duluth's baked routes and shapes are namespaced and stay inside its own service area", () => {
  assert.ok(Object.keys(dtaFile.routes).length > 5, "should have Duluth's real route count");
  for (const id of Object.keys(dtaFile.routes)) assert.match(id, /^dta-/);
  const dta = parseTransit(dtaFile);
  for (const s of dta.shapes) {
    assert.match(s.route, /^dta-/);
    for (const [lon, lat] of s.path) {
      assert.ok(lon > -92.5 && lon < -91.8 && lat > 46.4 && lat < 47.1, `shape ${s.id} strays to ${lon},${lat}`);
    }
  }
});

test("mergeTransitFiles combines both agencies' routes and shapes, offsetting trip -> shape indices", () => {
  const merged = mergeTransitFiles(file, dtaFile);
  assert.equal(Object.keys(merged.routes).length, Object.keys(file.routes).length + Object.keys(dtaFile.routes).length);
  assert.equal(merged.shapes.length, file.shapes.length + dtaFile.shapes.length);

  const transit = parseTransit(merged);
  // A Metro Transit route is untouched...
  assert.equal(transit.routes["901"]?.mode, "rail");
  // ...and a Duluth route now sits alongside it in the same lookup.
  const dtaRouteId = Object.keys(dtaFile.routes)[0];
  assert.ok(transit.routes[dtaRouteId]);

  // Every Duluth trip must resolve into the COMBINED shapes array, not the
  // index it had inside dta-transit.json alone.
  const [dtaTripId] = Object.entries(dtaFile.trips)[0];
  const resolved = transit.shapeForTrip(dtaTripId);
  assert.ok(resolved, `${dtaTripId} didn't resolve after merging`);
  assert.match(resolved!.route, /^dta-/);

  // A Metro Transit trip still resolves too, from the unshifted first half of the array.
  const [metroTripId] = Object.entries(file.trips)[0];
  assert.ok(transit.shapeForTrip(metroTripId));
});
