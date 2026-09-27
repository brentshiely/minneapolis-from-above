import { test } from "node:test";
import assert from "node:assert/strict";
import { compassWord, describeMoon, moonAt, moonEvents, moonPhase, moonPosition, nextPhase } from "../src/moon.ts";

const near = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}±${tol}, got ${actual}`);
const minutesApart = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 60_000;

// Published values from the US Naval Observatory (aa.usno.navy.mil), for
// Minneapolis at 44.98 N, 93.27 W.

test("phases land on USNO's published times, 2026", () => {
  const cases: [string, number, string][] = [
    ["2026-08-05T00:00:00Z", 0, "2026-08-12T17:37:00Z"], // new moon
    ["2026-06-15T00:00:00Z", 90, "2026-06-21T21:55:00Z"], // first quarter
    ["2026-09-19T00:00:00Z", 180, "2026-09-26T16:49:00Z"], // full moon
    ["2026-09-27T00:00:00Z", 270, "2026-10-03T13:25:00Z"], // last quarter
    ["2026-12-20T00:00:00Z", 180, "2026-12-24T01:28:00Z"], // full moon
  ];
  for (const [from, target, published] of cases) {
    near(minutesApart(nextPhase(new Date(from), target), new Date(published)), 0, 10, `phase ${target} near ${published}`);
  }
});

test("illumination: full, half, new and in between", () => {
  const full = moonPhase(new Date("2026-09-26T16:49:00Z"));
  assert.ok(full.illumination > 0.99, `full ${full.illumination}`);
  assert.equal(full.name, "Full moon");
  const quarter = moonPhase(new Date("2026-10-03T13:25:00Z"));
  near(quarter.illumination, 0.5, 0.02, "last quarter");
  assert.equal(quarter.name, "Last quarter");
  assert.equal(quarter.waxing, false);
  const nw = moonPhase(new Date("2026-08-12T17:37:00Z"));
  assert.ok(nw.illumination < 0.01, `new ${nw.illumination}`);
  assert.equal(nw.name, "New moon");
  // USNO's daily figure is for local noon: 28% lit on June 19, 2026,
  // 48% on Oct 3, 99% on Dec 24.
  const jun19 = moonPhase(new Date("2026-06-19T17:00:00Z"));
  near(jun19.illumination, 0.28, 0.02, "June 19");
  assert.equal(jun19.name, "Waxing crescent");
  near(moonPhase(new Date("2026-10-03T17:00:00Z")).illumination, 0.48, 0.02, "Oct 3");
  const dec24 = moonPhase(new Date("2026-12-24T18:00:00Z"));
  near(dec24.illumination, 0.99, 0.01, "Dec 24");
  assert.equal(dec24.name, "Waning gibbous");
  assert.equal(moonPhase(new Date("2026-12-24T06:00:00Z")).name, "Full moon", "still called full a few hours after");
  assert.equal(moonPhase(new Date("2026-12-26T06:00:00Z")).name, "Waning gibbous");
});

test("position matches Meeus' worked example (1992 April 12)", () => {
  // Meeus example 47.a: distance 368,409.7 km at 0h TD.
  const p = moonPosition(new Date("1992-04-12T00:00:00Z"));
  near(p.distanceKm, 368_410, 300, "distance");
});

/** Rise and set within one Minneapolis local day. */
function localDay(isoDate: string, offsetH: number) {
  const start = new Date(`${isoDate}T00:00:00Z`).getTime() - offsetH * 3_600_000;
  const events = moonEvents(new Date(start), new Date(start + 86_400_000));
  const hm = (d?: Date) => (d ? Math.round((d.getTime() - start) / 60_000) : NaN);
  return { rise: hm(events.find((e) => e.kind === "rise")?.at), set: hm(events.find((e) => e.kind === "set")?.at) };
}
const at = (h: number, m: number) => h * 60 + m;

test("moonrise and moonset match USNO for Minneapolis", () => {
  // Full moon, Sept 26, 2026 (CDT): sets 7:02 AM, rises 6:50 PM.
  let d = localDay("2026-09-26", -5);
  near(d.set, at(7, 2), 2, "Sep 26 set");
  near(d.rise, at(18, 50), 2, "Sep 26 rise");
  // Last quarter, Oct 3 (CDT): sets 3:25 PM, rises 11:56 PM.
  d = localDay("2026-10-03", -5);
  near(d.set, at(15, 25), 2, "Oct 3 set");
  near(d.rise, at(23, 56), 2, "Oct 3 rise");
  // Christmas Eve full moon (CST): sets 8:46 AM, rises 5:19 PM.
  d = localDay("2026-12-24", -6);
  near(d.set, at(8, 46), 2, "Dec 24 set");
  near(d.rise, at(17, 19), 2, "Dec 24 rise");
  // Waxing crescent, June 19 (CDT): sets 12:08 AM, rises 10:47 AM.
  d = localDay("2026-06-19", -5);
  near(d.set, at(0, 8), 2, "Jun 19 set");
  near(d.rise, at(10, 47), 2, "Jun 19 rise");
});

test("the full moon rises in the east around sunset and is high and south at midnight", () => {
  const rising = moonPosition(new Date("2026-09-26T23:52:00Z"));
  near(rising.elevation, 0, 1.5, "on the horizon at moonrise");
  assert.ok(rising.azimuth > 70 && rising.azimuth < 110, `east-ish ${rising.azimuth}`);
  const midnight = moonPosition(new Date("2026-09-26T05:39:00Z")); // USNO: upper transit 12:39 AM CDT
  near(midnight.azimuth, 180, 3, "due south at transit");
  assert.ok(midnight.elevation > 35 && midnight.elevation < 50, `elevation ${midnight.elevation}`);
});

test("describes the moon in plain language", () => {
  assert.equal(compassWord(0), "north");
  assert.equal(compassWord(134), "southeast");
  assert.equal(compassWord(350), "north");
  const up = describeMoon(moonAt(new Date("2026-09-27T03:00:00Z"))); // 10 PM CDT
  assert.equal(up.title, "The moon");
  assert.match(up.detail!, /^(Full moon|Waning gibbous), (99|100)% lit\. Up now in the (east|southeast), \d+° above the horizon\. Sets at [78]:\d\d AM\.$/);
  assert.match(up.meta, /^Next new moon Saturday, Oct 10$/);
  const down = describeMoon(moonAt(new Date("2026-09-26T21:00:00Z"))); // 4 PM CDT
  assert.match(down.detail!, /Below the horizon now\. Rises at 6:49 PM in the east\.$/);
  const crescent = describeMoon(moonAt(new Date("2026-06-20T02:00:00Z")));
  assert.match(crescent.detail!, /^Waxing crescent, 3[01]% lit\. Up now in the southwest, \d+° above the horizon\. Sets at 12:\d\d AM\.$/);
  assert.match(crescent.meta, /^Next full moon Monday, Jun 29$/);
});
