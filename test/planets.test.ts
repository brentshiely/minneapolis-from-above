import { test } from "node:test";
import assert from "node:assert/strict";
import { describePlanet, planetAt, planetPosition } from "../src/planets.ts";
import { nearPeak, showers } from "../src/meteors.ts";

const near = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}±${tol}, got ${actual}`);

// Published values from NASA/JPL Horizons (ssd.jpl.nasa.gov/horizons), apparent
// topocentric azimuth/elevation and apparent magnitude, for 44.9778N 93.265W.

test("Venus matches Horizons, 2026-09-26 00:00 UT", () => {
  const p = planetPosition("Venus", new Date("2026-09-26T00:00:00Z"));
  near(p.azimuth, 233.68, 3, "Venus azimuth");
  near(p.elevation, 5.79, 3, "Venus elevation");
  near(p.magnitude, -4.80, 0.3, "Venus magnitude");
});

test("Jupiter matches Horizons, 2026-09-26 10:00 UT", () => {
  const p = planetPosition("Jupiter", new Date("2026-09-26T10:00:00Z"));
  near(p.azimuth, 85.94, 3, "Jupiter azimuth");
  near(p.elevation, 18.48, 3, "Jupiter elevation");
  near(p.magnitude, -1.86, 0.3, "Jupiter magnitude");
});

test("Mars matches Horizons, 2026-09-26 02:00 UT", () => {
  const p = planetPosition("Mars", new Date("2026-09-26T02:00:00Z"));
  near(p.azimuth, 0.51, 3, "Mars azimuth");
  near(p.elevation, -23.71, 3, "Mars elevation");
  near(p.magnitude, 1.07, 0.3, "Mars magnitude");
});

test("Saturn matches Horizons, 2026-09-26 04:00 UT", () => {
  const p = planetPosition("Saturn", new Date("2026-09-26T04:00:00Z"));
  near(p.azimuth, 128.30, 3, "Saturn azimuth");
  near(p.elevation, 34.50, 3, "Saturn elevation");
  near(p.magnitude, 0.37, 0.3, "Saturn magnitude");
});

test("describes a visible planet in plain language", () => {
  const d = describePlanet(planetAt("Venus", new Date("2026-09-26T00:00:00Z")));
  assert.equal(d.title, "Venus");
  assert.match(d.detail!, /^The brightest planet, up in the southwest, \d+° above the horizon\./);
});

test("describes a planet below the horizon", () => {
  const d = describePlanet(planetAt("Mars", new Date("2026-09-26T02:00:00Z")));
  assert.match(d.detail!, /below the horizon now\./);
});

// --- meteor showers ----------------------------------------------------------

test("shower table has the eight well-known annual showers", () => {
  assert.equal(showers.length, 8);
  const names = showers.map((s) => s.name);
  for (const n of ["Quadrantids", "Lyrids", "Eta Aquariids", "Perseids", "Orionids", "Leonids", "Geminids", "Ursids"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
});

test("Perseids peak is recognized within a couple of days", () => {
  assert.ok(nearPeak(new Date("2026-08-12T12:00:00Z")), "on peak day");
  assert.ok(nearPeak(new Date("2026-08-13T12:00:00Z")), "day after");
  assert.ok(nearPeak(new Date("2026-08-11T12:00:00Z")), "day before");
  assert.equal(nearPeak(new Date("2026-08-05T12:00:00Z")), undefined, "a week before: nothing");
});

test("Geminids peak in December is found, and named correctly", () => {
  const s = nearPeak(new Date("2026-12-14T06:00:00Z"));
  assert.equal(s?.name, "Geminids");
});

test("no shower most of the year", () => {
  assert.equal(nearPeak(new Date("2026-02-15T12:00:00Z")), undefined);
  assert.equal(nearPeak(new Date("2026-07-01T12:00:00Z")), undefined);
});
