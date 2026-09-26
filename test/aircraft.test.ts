import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toAircraftResponse, onRequestGet, resetAircraftCache, type AircraftRow } from "../functions/api/aircraft.ts";
import { AirFleet, PLANE_STALE_S } from "../src/live/aircraft.ts";
import { distM, M_PER_DEG_LAT } from "../src/transit/data.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/adsblol.json", import.meta.url), "utf8"));

test("trims adsb.lol aircraft to compact rows over the metro", () => {
  const body = toAircraftResponse(fixture);
  assert.ok(body.a.length > 10, `${body.a.length} aircraft`);
  assert.equal(body.t, Math.round(fixture.now / 100) / 10);
  const delta = body.a.find((r) => r[1] === "DAL2437")!;
  assert.deepEqual(delta.slice(0, 2), ["ab92c4", "DAL2437"]);
  assert.equal(delta[4], 17975);      // altitude ft
  assert.equal(delta[5], 422.4);      // ground speed kt
  assert.equal(delta[6], 276.1);      // track
  assert.equal(delta[7], "B739");
  assert.equal(delta[10], 1984);      // climbing ft/min
  const ground = body.a.filter((r) => r[4] === 0);
  assert.ok(ground.length > 0, "ground aircraft kept, at altitude 0");
  for (const r of body.a) assert.ok(r[2] > 44.3 && r[2] < 45.8 && r[3] > -94.6 && r[3] < -92.2);
});

test("drops positions over a minute old and aircraft outside the area", () => {
  const body = toAircraftResponse({ now: 1e12, ac: [
    { hex: "a", lat: 44.9, lon: -93.2, seen_pos: 75 },
    { hex: "b", lat: 41.9, lon: -87.6, seen_pos: 1 },
    { hex: "c", lat: 44.9, lon: -93.2, seen_pos: 2, alt_baro: "ground" },
  ] });
  assert.deepEqual(body.a.map((r) => r[0]), ["c"]);
});

test("endpoint returns a clear 502 when adsb.lol fails and nothing is cached", async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  resetAircraftCache();
  globalThis.fetch = async () => new Response("", { status: 429 });
  const res = await onRequestGet();
  assert.equal(res.status, 502);
  assert.match(((await res.json()) as { error: string }).error, /429/);
});

test("falls back to adsb.fi when adsb.lol rate-limits", async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  resetAircraftCache();
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(new URL(url).host);
    if (url.includes("adsb.lol")) return new Response("", { status: 429 });
    return new Response(JSON.stringify({ now: fixture.now, aircraft: fixture.ac }));
  }) as typeof fetch;
  const res = await onRequestGet();
  assert.equal(res.status, 200);
  assert.deepEqual(asked, ["api.adsb.lol", "opendata.adsb.fi"]);
  assert.ok(((await res.json()) as { a: unknown[] }).a.length > 10, "adsb.fi's `aircraft` list is read");
});

test("endpoint reuses a fresh snapshot, and rides out rate limits on a recent one", async (t) => {
  const real = globalThis.fetch;
  const realNow = Date.now;
  t.after(() => { globalThis.fetch = real; Date.now = realNow; });
  resetAircraftCache();
  let calls = 0, clock = 1_000_000_000;
  Date.now = () => clock;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(fixture)); };
  assert.equal((await onRequestGet()).status, 200);
  clock += 2000;
  assert.equal((await onRequestGet()).status, 200);
  assert.equal(calls, 1, "second request within 4 s served from memory");

  globalThis.fetch = async () => { calls++; return new Response("", { status: 429 }); };
  clock += 10_000;
  const busy = await onRequestGet();
  assert.equal(busy.status, 200, "rate-limited: serves the 12 s old snapshot");
  assert.ok(((await busy.json()) as { a: unknown[] }).a.length > 10);
  clock += 30_000;
  assert.equal((await onRequestGet()).status, 502, "too old to serve");
});

// A plane at 44.9,-93.2 heading due east at 200 kt (~102.9 m/s).
const row = (lon: number, t = 0, track = 90, gs = 200): AircraftRow =>
  ["abc", "SKW123", 44.9, lon, 3000, gs, track, "CRJ9", "N123", t, -700];

test("dead-reckons smoothly between fixes", () => {
  const air = new AirFleet();
  air.update([row(-93.2)], 0);
  air.advance(0, 0);
  const start = air.planes.get("abc")!.position;
  air.advance(10, 10);
  const moved = distM(start, air.planes.get("abc")!.position);
  assert.ok(Math.abs(moved - 1028.9) < 5, `moved ${moved} m in 10 s`);
});

test("uses the position's age, not the arrival time", () => {
  const air = new AirFleet();
  air.update([row(-93.2, 4)], 100); // measured 4 s before it arrived
  air.advance(0, 100);
  const kx = M_PER_DEG_LAT * Math.cos((44.9 * Math.PI) / 180);
  const east = (air.planes.get("abc")!.position[0] - -93.2) * kx;
  assert.ok(Math.abs(east - 411.6) < 3, `${east} m east`);
});

test("corrections ease in instead of snapping", () => {
  const air = new AirFleet();
  air.update([row(-93.2)], 0);
  air.advance(5, 5);
  const before = air.planes.get("abc")!.position;
  // New fix says the plane is 300 m further west than we predicted.
  const kx = M_PER_DEG_LAT * Math.cos((44.9 * Math.PI) / 180);
  const predictedLon = -93.2 + (102.89 * 5) / kx;
  air.update([row(predictedLon - 300 / kx, 0)], 5);
  air.advance(0.016, 5.016);
  assert.ok(distM(before, air.planes.get("abc")!.position) < 5, "no visible jump on the fix");
  air.advance(8, 13);
  const expected: [number, number] = [predictedLon - 300 / kx + (102.89 * 8) / kx, 44.9];
  assert.ok(distM(air.planes.get("abc")!.position, expected) < 3, "converged onto the new track");
});

test("headings ease through turns", () => {
  const air = new AirFleet();
  air.update([row(-93.2, 0, 90)], 0);
  air.update([row(-93.19, 0, 180)], 1);
  air.advance(0.5, 1.5);
  const h = air.planes.get("abc")!.heading;
  assert.ok(h > 90 && h < 180, `heading ${h} mid-turn`);
  air.advance(10, 11.5);
  assert.ok(Math.abs(air.planes.get("abc")!.heading - 180) < 0.1);
});

test("stops extrapolating after 30 s without a fix, then fades out", () => {
  const air = new AirFleet();
  air.update([row(-93.2)], 0);
  air.advance(30, 30);
  const at30 = air.planes.get("abc")!.position;
  air.advance(10, 40);
  assert.deepEqual(air.planes.get("abc")!.position, at30, "holds after 30 s");
  assert.ok(air.planes.get("abc")!.alpha < 0.5);
  air.prune(PLANE_STALE_S + 1);
  assert.equal(air.planes.size, 0);
});

test("ground aircraft with no track sit still", () => {
  const air = new AirFleet();
  air.update([["g", "", 44.88, -93.22, 0, null, null, "B738", "", 0, null]], 0);
  air.advance(20, 20);
  const p = air.planes.get("g")!;
  assert.ok(p.onGround);
  assert.deepEqual(p.position, [-93.22, 44.88]);
});
