import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { decodeVehicleFeed } from "../functions/_lib/gtfsrt.ts";
import { inServiceArea, onRequestGet, toResponse, type VehiclesResponse } from "../functions/api/vehicles.ts";

const fixture = new Uint8Array(readFileSync(new URL("./fixtures/vehiclepositions.pb", import.meta.url)));

test("decoder matches the official GTFS-realtime bindings on a real snapshot", () => {
  const ours = decodeVehicleFeed(fixture);
  const ref = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(fixture);
  const refVehicles = ref.entity.filter((e) => e.vehicle?.position);

  assert.ok(ours.vehicles.length > 50, `only ${ours.vehicles.length} vehicles`);
  assert.equal(ours.vehicles.length, refVehicles.length);
  assert.equal(ours.timestamp, Number(ref.header.timestamp));

  refVehicles.forEach((e, i) => {
    const a = ours.vehicles[i], v = e.vehicle!;
    assert.equal(a.id, v.vehicle?.id || e.id);
    assert.equal(a.tripId, v.trip?.tripId ?? "");
    assert.equal(a.routeId, v.trip?.routeId ?? "");
    assert.equal(a.lat, v.position!.latitude);
    assert.equal(a.lon, v.position!.longitude);
    // The bindings report absent optional fields as their proto default, 0.
    assert.equal(a.bearing ?? 0, v.position!.bearing ?? 0);
    assert.equal(a.timestamp ?? 0, Number(v.timestamp ?? 0));
  });
});

test("response keeps real positions and drops vehicles with no GPS fix", () => {
  const decoded = decodeVehicleFeed(fixture).vehicles;
  const body = toResponse(fixture);
  const bogus = decoded.filter((v) => !inServiceArea(v.lat, v.lon));
  // The snapshot happens to include a vehicle reporting 0,0.
  assert.ok(bogus.every((v) => Math.abs(v.lat) < 1 && Math.abs(v.lon) < 1), "unexpected out-of-area vehicle");
  assert.equal(body.v.length, decoded.length - bogus.length);
  for (const [id, , , lat, lon] of body.v) {
    assert.ok(lat > 44.4 && lat < 45.7 && lon > -94.5 && lon < -92.3, `${id} at ${lat},${lon}`);
  }
});

test("response rows are compact and rounded", () => {
  const body = toResponse(fixture);
  const [id, trip, route, lat, lon, ts] = body.v[0];
  assert.equal(typeof id, "string");
  assert.equal(typeof trip, "string");
  assert.equal(typeof route, "string");
  assert.equal(lat, Math.round(lat * 1e5) / 1e5);
  assert.equal(lon, Math.round(lon * 1e5) / 1e5);
  assert.ok(ts > 1.7e9);
  assert.ok(JSON.stringify(body).length < fixture.length * 1.5);
});

test("truncated feeds throw instead of returning garbage", () => {
  assert.throws(() => decodeVehicleFeed(fixture.subarray(0, 1000)));
});

test("handler returns JSON with a short cache, and a clear 502 when upstream fails", async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  globalThis.fetch = async () => new Response(fixture);
  const ok = await onRequestGet();
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("cache-control")!, /max-age=10/);
  const body = (await ok.json()) as VehiclesResponse;
  assert.ok(body.v.length > 50);

  globalThis.fetch = async () => new Response("nope", { status: 503 });
  const bad = await onRequestGet();
  assert.equal(bad.status, 502);
  assert.match(((await bad.json()) as { error: string }).error, /503/);

  globalThis.fetch = async () => { throw new TypeError("network down"); };
  assert.equal((await onRequestGet()).status, 502);
});
