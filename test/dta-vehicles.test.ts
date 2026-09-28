import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeVehicleFeed } from "../functions/_lib/gtfsrt.ts";
import { inServiceArea, onRequestGet, toResponse } from "../functions/api/dta-vehicles.ts";
import type { VehiclesResponse } from "../functions/api/vehicles.ts";

// A real snapshot from duluthtransit.com/gtfsrt/Vehicle/VehiclePositions.pb (Sept 2026).
// The decoder itself is already verified against the official GTFS-realtime
// bindings in test/vehicles.test.ts; this file only covers what's specific
// to the DTA endpoint: the "dta-" id prefix and the Duluth-Superior bbox.
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/dta-vehiclepositions.pb", import.meta.url)));

test("toResponse prefixes every id so it can never collide with Metro Transit's", () => {
  const decoded = decodeVehicleFeed(fixture).vehicles;
  const body = toResponse(fixture);
  assert.ok(body.v.length > 10, `only ${body.v.length} vehicles`);
  assert.equal(body.v.length, decoded.filter((v) => inServiceArea(v.lat, v.lon)).length);
  for (const [id, trip, route] of body.v) {
    assert.match(id, /^dta-/);
    assert.match(trip, /^dta-/);
    assert.match(route, /^dta-/);
  }
});

test("inServiceArea covers Duluth-Superior and rejects a Minneapolis coordinate", () => {
  assert.ok(inServiceArea(46.78, -92.10), "downtown Duluth");
  assert.ok(inServiceArea(46.72, -92.10), "Superior, WI, across the harbor");
  assert.ok(!inServiceArea(44.98, -93.27), "Minneapolis is a different agency's territory");
});

test("response rows are compact and rounded, same shape as Metro Transit's", () => {
  const body = toResponse(fixture);
  const [id, trip, route, lat, lon, ts] = body.v[0];
  assert.equal(typeof id, "string");
  assert.equal(typeof trip, "string");
  assert.equal(typeof route, "string");
  assert.equal(lat, Math.round(lat * 1e5) / 1e5);
  assert.equal(lon, Math.round(lon * 1e5) / 1e5);
  assert.ok(ts > 1.7e9);
});

test("handler returns JSON with a short cache, and a clear 502 when upstream fails", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  globalThis.fetch = async () => new Response(fixture);
  const ok = await onRequestGet();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control")!, /max-age=10/);
  const body = (await ok.json()) as VehiclesResponse;
  assert.ok(body.v.length > 10);

  globalThis.fetch = async () => new Response("nope", { status: 503 });
  const bad = await onRequestGet();
  assert.equal(bad.status, 502);
  assert.match(((await bad.json()) as { error: string }).error, /503/);

  globalThis.fetch = async () => { throw new TypeError("network down"); };
  assert.equal((await onRequestGet()).status, 502);
});
