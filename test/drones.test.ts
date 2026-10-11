import { test } from "node:test";
import assert from "node:assert/strict";
import { displace, droneFlights, MIN_AGE_S, offsetFor, onRequestGet, reasonFor } from "../functions/api/drones.ts";
import { describeDrone, droneStrength, FADE_DAYS } from "../src/drones/drones.ts";

const NOW = 1_800_000_000;
const feature = (o: Partial<{ id: string; ageS: number; purpose: string; paths: [number, number][][] }> = {}) => ({
  attributes: { flight_id: o.id ?? "flight-1", takeoff: (NOW - (o.ageS ?? 6 * 3600)) * 1000, flight_purpose: o.purpose ?? "MN 626.19 Reasonable Suspicion of Criminal Activity (Exception 7)" },
  geometry: { paths: o.paths ?? [[[-93.1, 44.95], [-93.09, 44.95], [-93.08, 44.96]]] as [number, number][][] },
});
const metersBetween = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 111_320);

test("reasonFor puts each department's wording in plain terms and drops training and tests", () => {
  assert.equal(reasonFor("MN 626.19 Reasonable Suspicion of Criminal Activity (Exception 7)"), "possible criminal activity");
  assert.equal(reasonFor("MN 626.19 Emergency Situation (Exception 1)"), "an emergency or a missing person");
  assert.equal(reasonFor("MN 626.19 Missing Person (Exception 11)"), "an emergency or a missing person");
  assert.equal(reasonFor("ATTEMPT TO LOCATE"), "an emergency or a missing person");
  assert.equal(reasonFor("TRAFFIC CRASH"), "a traffic crash");
  assert.equal(reasonFor("SUSPICIOUS INCIDENT"), "possible criminal activity");
  assert.equal(reasonFor("Something new"), "a police call");
  assert.equal(reasonFor(undefined), "a police call");
  assert.equal(reasonFor("Officer training or public relations purposes"), undefined);
  assert.equal(reasonFor("Test flight"), undefined);
});

test("a flight is shifted 60-140 m by an offset fixed by its id, so it never moves between polls", () => {
  for (const id of ["a", "b", "flight-1", "f7eca6a2-02fe-4db1-815d-5d9bc2def1ed"]) {
    const [e, n] = offsetFor(id);
    const m = Math.hypot(e, n);
    assert.ok(m >= 60 && m <= 140.01, `${id}: ${m}`);
    assert.deepEqual(offsetFor(id), [e, n]);
  }
  assert.notDeepEqual(offsetFor("a"), offsetFor("b"));
});

test("displace moves every vertex by the same amount, keeping the flight's shape", () => {
  const src: [number, number][][] = [[[-93.1, 44.95], [-93.09, 44.95], [-93.08, 44.96]]];
  const out = displace("flight-1", src);
  const moved = metersBetween(src[0][0], out[0][0]);
  assert.ok(moved > 40 && moved < 160, `moved ${moved} m`);
  // The same shift everywhere (within the rounding to about 10 m).
  const d0 = [out[0][0][0] - src[0][0][0], out[0][0][1] - src[0][0][1]];
  const d2 = [out[0][2][0] - src[0][2][0], out[0][2][1] - src[0][2][1]];
  assert.ok(Math.abs(d0[0] - d2[0]) < 0.0002 && Math.abs(d0[1] - d2[1]) < 0.0002);
});

test("displace thins a long path and rounds coordinates", () => {
  const long: [number, number][][] = [Array.from({ length: 1000 }, (_, i) => [-93.1 + i * 1e-5, 44.95] as [number, number])];
  const out = displace("x", long);
  assert.ok(out[0].length <= 200, `kept ${out[0].length}`);
  assert.ok(out[0].every(([lon, lat]) => Math.abs(lon * 1e4 - Math.round(lon * 1e4)) < 1e-6 && Math.abs(lat * 1e4 - Math.round(lat * 1e4)) < 1e-6));
  assert.deepEqual(displace("x", [[[-93.1, 44.95]]]), [], "a single point isn't a path");
});

test("droneFlights keeps responses, holds back the newest three hours, and drops what is too old, test flights and anything without a path", () => {
  const out = droneFlights("St. Paul", [
    feature({ id: "ok", ageS: 6 * 3600 }),
    feature({ id: "fresh", ageS: MIN_AGE_S - 60 }),
    feature({ id: "old", ageS: 3 * 86_400 }),
    feature({ id: "train", purpose: "Officer training or public relations purposes" }),
    { attributes: { flight_id: "nopath", takeoff: (NOW - 6 * 3600) * 1000, flight_purpose: "x" } },
    { attributes: { takeoff: 1, flight_purpose: "x" }, geometry: { paths: [[[-93, 44], [-93.1, 44.1]]] as [number, number][][] } },
  ], NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].city, "St. Paul");
  assert.equal(out[0].reason, "possible criminal activity");
});

test("nothing identifying leaves the server: no case number, pilot, serial or free text", () => {
  const raw = { attributes: { ...feature().attributes, external_id: "26184358", user_email: "pilot@city.gov", description: "autistic child in pond", vehicle_serial: "X1" }, geometry: feature().geometry };
  const [f] = droneFlights("St. Paul", [raw], NOW);
  const text = JSON.stringify(f);
  for (const leak of ["26184358", "pilot@", "autistic", "X1", "flight-1"]) assert.ok(!text.includes(leak), `leaked ${leak}`);
});

test("strength fades from 1 to 0 over the fade window and never goes negative", () => {
  const f = droneFlights("St. Paul", [feature({ ageS: 6 * 3600 })], NOW)[0];
  assert.equal(droneStrength(f, f.takeoff), 1);
  assert.ok(Math.abs(droneStrength(f, f.takeoff + (FADE_DAYS / 2) * 86_400) - 0.5) < 1e-9);
  assert.equal(droneStrength(f, f.takeoff + FADE_DAYS * 86_400), 0);
  assert.equal(droneStrength(f, f.takeoff + 9 * 86_400), 0);
});

test("describeDrone says what happened and why, with no details of the call", () => {
  const f = droneFlights("Duluth", [feature({ ageS: 6 * 3600 })], NOW)[0];
  const d = describeDrone(f, f.takeoff + 3 * 3600);
  assert.equal(d.title, "A police drone was sent to a call.");
  assert.match(d.detail!, /Duluth, 3 hours ago\. Reason logged: possible criminal activity\./);
  assert.match(d.meta, /approximate/);
});

test("handler combines the departments, and rides out any being down", async () => {
  const realFetch = globalThis.fetch;
  const nowMs = Date.now();
  const body = (id: string) => JSON.stringify({ features: [{ attributes: { flight_id: id, takeoff: nowMs - 6 * 3600_000, flight_purpose: "ATTEMPT TO LOCATE" }, geometry: { paths: [[[-93.1, 44.95], [-93.09, 44.96]]] } }] });
  try {
    globalThis.fetch = (async (url: string) => new Response(body(String(url).slice(-40)))) as typeof fetch;
    const ok = await onRequestGet();
    const okBody = (await ok.json()) as { flights: { city: string }[]; failed?: unknown };
    assert.equal(okBody.flights.length, 6);
    assert.equal(okBody.failed, undefined);
    assert.match(ok.headers.get("cache-control")!, /max-age=1800/);

    globalThis.fetch = (async (url: string) => (String(url).includes("bc5608cb") ? new Response("down", { status: 503 }) : new Response(body("z")))) as typeof fetch;
    const part = await onRequestGet();
    const partBody = (await part.json()) as { flights: unknown[]; failed?: { city: string }[] };
    assert.equal(partBody.flights.length, 5);
    assert.deepEqual(partBody.failed?.map((x) => x.city), ["St. Paul"]);
    assert.match(part.headers.get("cache-control")!, /max-age=90\b/);

    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally { globalThis.fetch = realFetch; }
});
