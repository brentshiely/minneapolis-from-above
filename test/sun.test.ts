import { test } from "node:test";
import assert from "node:assert/strict";
import { daylight, sunPosition } from "../src/sun.ts";

/**
 * Find when the sun crosses the horizon on a given day (upper limb with
 * refraction, the usual sunrise definition: center at -0.833°).
 */
function crossing(dayUtc: string, rising: boolean): Date {
  const start = Date.parse(dayUtc);
  let prev = sunPosition(new Date(start)).elevation;
  for (let m = 1; m <= 1440; m++) {
    const t = new Date(start + m * 60_000);
    const el = sunPosition(t).elevation;
    if (rising ? prev < -0.833 && el >= -0.833 : prev > -0.833 && el <= -0.833) return t;
    prev = el;
  }
  throw new Error("no crossing");
}

const hm = (d: Date, offsetH: number) => {
  const local = new Date(d.getTime() + offsetH * 3_600_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};
const near = (actual: number, expected: number, tol: number, msg: string) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: expected ${expected}±${tol}, got ${actual}`);

// Published NOAA times for Minneapolis (44.98 N, 93.27 W).
test("sunrise and sunset match published times, summer solstice", () => {
  // 2026-06-21: sunrise 5:26, sunset 9:03 CDT (UTC-5)
  near(hm(crossing("2026-06-21T05:00:00Z", true), -5), 5 * 60 + 26, 3, "sunrise");
  near(hm(crossing("2026-06-21T15:00:00Z", false), -5), 21 * 60 + 3, 3, "sunset");
});

test("sunrise and sunset match published times, winter solstice", () => {
  // 2026-12-21: sunrise 7:49, sunset 4:33 CST (UTC-6)
  near(hm(crossing("2026-12-21T06:00:00Z", true), -6), 7 * 60 + 49, 3, "sunrise");
  near(hm(crossing("2026-12-21T18:00:00Z", false), -6), 16 * 60 + 33, 3, "sunset");
});

test("solar noon: highest in June, due south", () => {
  // Solar noon in Minneapolis on the June solstice is about 13:14 CDT.
  const noon = sunPosition(new Date("2026-06-21T18:14:00Z"));
  near(noon.elevation, 68.5, 0.5, "elevation");
  near(noon.azimuth, 180, 2, "azimuth");
});

test("azimuth: east in the morning, west in the evening", () => {
  const morning = sunPosition(new Date("2026-09-22T13:30:00Z")); // 8:30 CDT
  const evening = sunPosition(new Date("2026-09-22T23:00:00Z")); // 18:00 CDT
  assert.ok(morning.azimuth > 90 && morning.azimuth < 130, `morning ${morning.azimuth}`);
  assert.ok(evening.azimuth > 240 && evening.azimuth < 280, `evening ${evening.azimuth}`);
  assert.ok(sunPosition(new Date("2026-09-23T06:00:00Z")).elevation < -30, "1 am is deep night");
});

test("daylight blends through twilight", () => {
  assert.equal(daylight(-20), 0);
  assert.equal(daylight(-6), 0);
  assert.equal(daylight(0), 0.5);
  assert.equal(daylight(6), 1);
  assert.equal(daylight(40), 1);
  assert.ok(daylight(-3) > 0 && daylight(-3) < 0.5);
});
