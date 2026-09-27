import { test } from "node:test";
import assert from "node:assert/strict";
import { airPhrase, category, hazeColor, hazeFor, hazeStrength, parseAir, previewAir } from "../src/weather/air.ts";

// A real Open-Meteo answer for Minneapolis (September 2026), trimmed.
const real = {
  latitude: 45.0, longitude: -93.299995, utc_offset_seconds: 0, timezone: "GMT",
  current: {
    time: "2026-09-27T00:00", interval: 3600,
    us_aqi: 53, us_aqi_pm2_5: 53, us_aqi_pm10: 10, us_aqi_ozone: 27,
    us_aqi_nitrogen_dioxide: 5, us_aqi_sulphur_dioxide: 1, us_aqi_carbon_monoxide: 2,
  },
};

test("a real Open-Meteo reading: moderate, from fine particles", () => {
  const a = parseAir(real)!;
  assert.equal(a.aqi, 53);
  assert.equal(a.pollutant, "fine particles");
  assert.equal(a.t, Date.parse("2026-09-27T00:00Z") / 1000);
  assert.equal(airPhrase(a), "AQI 53, moderate (fine particles)");
});

test("local times are turned back into UTC", () => {
  const a = parseAir({ utc_offset_seconds: -18000, current: { time: "2026-09-26T19:00", us_aqi: 40 } })!;
  assert.equal(a.t, Date.parse("2026-09-27T00:00Z") / 1000);
  assert.equal(a.pollutant, undefined, "no sub-indices, no pollutant named");
});

test("the main pollutant is the highest sub-index; heavy fine particles read as smoke", () => {
  const at = (over: Record<string, number>) => parseAir({ current: { time: "2026-07-01T20:00", us_aqi: 0, ...over } })!;
  assert.equal(at({ us_aqi: 112, us_aqi_pm2_5: 112, us_aqi_ozone: 60 }).pollutant, "smoke");
  assert.equal(at({ us_aqi: 88, us_aqi_pm2_5: 40, us_aqi_ozone: 88 }).pollutant, "ozone");
  assert.equal(at({ us_aqi: 70, us_aqi_pm2_5: 20, us_aqi_pm10: 70 }).pollutant, "dust");
  assert.equal(at({ us_aqi: 60, us_aqi_pm2_5: 60, us_aqi_ozone: 30 }).pollutant, "fine particles");
});

test("no reading, no answer", () => {
  assert.equal(parseAir({}), undefined);
  assert.equal(parseAir({ current: { time: "2026-07-01T20:00", us_aqi: null } }), undefined);
});

test("the EPA's categories, at their edges", () => {
  const cases: [number, string][] = [
    [0, "good"], [50, "good"], [51, "moderate"], [100, "moderate"], [101, "unhealthy for sensitive groups"],
    [150, "unhealthy for sensitive groups"], [151, "unhealthy"], [200, "unhealthy"], [201, "very unhealthy"],
    [300, "very unhealthy"], [301, "hazardous"], [500, "hazardous"],
  ];
  for (const [aqi, word] of cases) assert.equal(category(aqi), word, `AQI ${aqi}`);
});

test("the status line only mentions air that matters", () => {
  assert.equal(airPhrase(undefined), undefined);
  assert.equal(airPhrase({ t: 0, aqi: 50, pollutant: "ozone" }), undefined);
  assert.equal(airPhrase({ t: 0, aqi: 112, pollutant: "smoke" }), "AQI 112, unhealthy for sensitive groups (smoke)");
  assert.equal(airPhrase({ t: 0, aqi: 180 }), "AQI 180, unhealthy");
});

test("haze: none when good, growing with the AQI, never obscuring", () => {
  assert.equal(hazeStrength(0), 0);
  assert.equal(hazeStrength(50), 0);
  assert.ok(hazeStrength(51) > 0 && hazeStrength(100) <= 0.15, "faint while moderate");
  assert.ok(hazeStrength(151) >= 0.24, "clearly hazy once unhealthy");
  assert.ok(hazeStrength(500) <= 0.55 && hazeStrength(900) === hazeStrength(500), "strong but capped");
  let prev = 0;
  for (let aqi = 51; aqi <= 500; aqi++) {
    const s = hazeStrength(aqi);
    assert.ok(s >= prev, `rises at AQI ${aqi}`);
    prev = s;
  }
  assert.ok(hazeFor({ t: 0, aqi: 140, pollutant: "ozone" }) < hazeFor({ t: 0, aqi: 140, pollutant: "smoke" }), "ozone is paler");
  assert.equal(hazeFor(undefined), 0);
});

test("haze colors: warm for smoke, paler for ozone, lighter by day", () => {
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255); };
  const warm = (hex: string) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) - (n & 255); };
  for (const d of [0, 1]) {
    assert.ok(warm(hazeColor("smoke", d)) > 20, "smoke is brownish");
    assert.ok(warm(hazeColor("ozone", d)) < warm(hazeColor("smoke", d)));
  }
  assert.ok(lum(hazeColor("smoke", 1)) > lum(hazeColor("smoke", 0)));
  assert.ok(lum(hazeColor("ozone", 1)) > lum(hazeColor("smoke", 1)), "ozone is paler");
});

test("?air= previews", () => {
  assert.equal(previewAir(""), undefined);
  assert.equal(previewAir("smoke"), undefined, "needs a number");
  assert.deepEqual(({ ...previewAir("150"), t: 0 }), { t: 0, aqi: 150, pollutant: "smoke" });
  assert.equal(previewAir("80")!.pollutant, "fine particles");
  assert.equal(previewAir("smoke-200")!.aqi, 200);
  assert.equal(previewAir("ozone-120")!.pollutant, "ozone");
  assert.equal(previewAir("dust-90")!.pollutant, "dust");
  assert.equal(previewAir("999")!.aqi, 500);
});
