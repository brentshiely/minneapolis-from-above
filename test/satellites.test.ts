import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jday, propagate, sunPos, twoline2satrec } from "satellite.js";
import { inEarthShadow, kindOf, parseTles, positionAt, satrecOf, type SatPosition } from "../src/sky/orbits.ts";
import { describeSatellite, longDate, operatorWords, satName, type SatcatRecord, type UcsRow } from "../src/sky/describe.ts";

const tles = parseTles(readFileSync(new URL("./fixtures/sats-sample.tle", import.meta.url), "utf8"));
const satcat: Record<string, SatcatRecord> = JSON.parse(readFileSync(new URL("./fixtures/satcat-sample.json", import.meta.url), "utf8"));
const ucs: Record<string, UcsRow> = JSON.parse(readFileSync(new URL("../public/data/ucs.json", import.meta.url), "utf8"));

test("parses CelesTrak's three-line format and sorts satellites into kinds", () => {
  assert.equal(tles.length, 6);
  const byId = Object.fromEntries(tles.map((t) => [t.id, t]));
  assert.equal(kindOf(byId[25544]), "iss");
  assert.equal(kindOf(byId[48274]), "station");
  assert.equal(kindOf(byId[68149]), "starlink");
  assert.equal(kindOf(byId[24876]), "satellite");
});

test("SGP4 matches the standard verification case (Vallado, satellite 00005)", () => {
  const rec = twoline2satrec(
    "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
    "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
  );
  // At epoch: r = (7022.46529266, -1400.08296755, 0.03995155) km, TEME.
  const epoch = new Date(Date.UTC(2000, 0, 1) + (179.78495062 - 1) * 86_400_000);
  const pv = propagate(rec, epoch)!;
  assert.ok(Math.abs(pv.position.x - 7022.46529266) < 0.01, `x ${pv.position.x}`);
  assert.ok(Math.abs(pv.position.y - -1400.08296755) < 0.01, `y ${pv.position.y}`);
  assert.ok(Math.abs(pv.position.z - 0.03995155) < 0.01, `z ${pv.position.z}`);
});

test("the ISS at its epoch: about 260 miles up at about 17,100 mph", () => {
  const iss = tles.find((t) => t.id === 25544)!;
  const epochDay = Number(iss.l1.slice(20, 32));
  const year = 2000 + Number(iss.l1.slice(18, 20));
  const epoch = new Date(Date.UTC(year, 0, 1) + (epochDay - 1) * 86_400_000);
  const p = positionAt(satrecOf(iss)!, epoch)!;
  assert.ok(p.altKm > 400 && p.altKm < 440, `${p.altKm} km`);
  assert.ok(Math.abs(p.speedKms - 7.66) < 0.05, `${p.speedKms} km/s`);
  assert.ok(Math.abs(p.lat) <= 51.7, "stays within its 51.6° inclination");
});

test("Earth's shadow: dark directly behind the planet, lit on the sunward side and off to the side", () => {
  const date = new Date("2026-06-21T12:00:00Z");
  const sun = sunPos(jday(date)).rsun;
  const len = Math.hypot(sun.x, sun.y, sun.z);
  const u = { x: sun.x / len, y: sun.y / len, z: sun.z / len };
  const r = 6371 + 400;
  assert.equal(inEarthShadow({ x: -u.x * r, y: -u.y * r, z: -u.z * r }, date), true, "behind Earth: dark");
  assert.equal(inEarthShadow({ x: u.x * r, y: u.y * r, z: u.z * r }, date), false, "sunward: lit");
  // Behind Earth but two Earth radii off the Sun-Earth line: outside the shadow.
  const side = Math.abs(u.z) < 0.9 ? { x: -u.y, y: u.x, z: 0 } : { x: 0, y: -u.z, z: u.y };
  const sl = Math.hypot(side.x, side.y, side.z);
  const off = 2 * 6371;
  assert.equal(inEarthShadow({ x: -u.x * r + (side.x / sl) * off, y: -u.y * r + (side.y / sl) * off, z: -u.z * r + (side.z / sl) * off }, date), false, "off to the side: lit");
});

test("names people recognize", () => {
  assert.equal(satName("ISS (ZARYA)", 25544), "International Space Station");
  assert.equal(satName("CSS (TIANHE)", 48274), "Tiangong space station");
  assert.equal(satName("STARLINK-36992", 68149), "Starlink-36992");
  assert.equal(longDate("1998-11-20"), "November 20, 1998");
  assert.equal(operatorWords("National Aeronautics and Space Administration (NASA)/Multinational"), "NASA and international partners");
  assert.equal(operatorWords("DoD/US Air Force"), "the US military");
  assert.equal(operatorWords("Chang Guang Satellite Technology Co. Ltd."), "Chang Guang Satellite Technology Co. Ltd.");
});

const live = (over: Partial<SatPosition> = {}): SatPosition => ({
  lon: -93.2, lat: 44.95, altKm: 420, speedKms: 7.66, elevation: 60, azimuth: 225, eclipsed: true, ...over,
});
const describe = (id: number, over: Partial<SatPosition> = {}, sunElevation = -20) => {
  const t = tles.find((x) => x.id === id)!;
  return describeSatellite({ id, name: t.name, kind: kindOf(t), live: live(over), sunElevation, catalog: satcat[id], ucs: ucs[id] });
};

test("the ISS, all told", () => {
  const d = describe(25544);
  assert.equal(d.title, "International Space Station.");
  assert.match(d.detail!, /^A crewed laboratory, home to astronauts since 2000/);
  assert.match(d.detail!, /Launched November 20, 1998 from Baikonur, Kazakhstan on a Proton\./);
  assert.match(d.detail!, /Low Earth orbit: circles the planet every 93 minutes, tilted 51\.6° to the equator\./);
  assert.match(d.detail!, /Now 261 miles up, moving at 17,100 mph\./);
  assert.match(d.detail!, /In Earth's shadow, so not visible right now\./);
  assert.equal(d.meta, "NORAD 25544 · 1998-067A · radar size large");
});

test("a GPS satellite, from UCS: military navigation", () => {
  const d = describe(24876);
  assert.match(d.detail!, /^Operated by the US military for military and commercial navigation, from the United States\./);
  assert.match(d.detail!, /Launched July 23, 1997 from Cape Canaveral, Florida on a Delta 2\./);
  assert.match(d.detail!, /Medium Earth orbit: circles the planet every 12 hours/);
});

test("a Chinese Earth-imaging satellite and a Russian weather satellite", () => {
  assert.match(describe(43159).detail!, /^Operated by Chang Guang Satellite Technology Co\. Ltd\. for commercial Earth observation, from China\./);
  assert.match(describe(43159).detail!, /from Jiuquan, China on a Long March 11\./);
  const meteor = describe(57166);
  assert.match(meteor.detail!, /^A Meteor weather satellite, from Russia\./);
  assert.match(meteor.detail!, /from Vostochny, Russia\./);
});

test("Tiangong and a Starlink", () => {
  const css = describe(48274);
  assert.equal(css.title, "Tiangong space station.");
  assert.match(css.detail!, /^China's crewed space station/);
  assert.match(css.detail!, /from Wenchang, China\./);
  assert.match(describe(68149).detail!, /^A SpaceX Starlink internet satellite, from the United States\. Launched March 13, 2026 from Vandenberg, California\./);
});

test("whether you could see it", () => {
  assert.match(describe(25544, { eclipsed: false, elevation: 34, azimuth: 247 }).detail!, /Visible to the eye right now: look west-southwest, 34° above the horizon\./);
  assert.match(describe(25544, { eclipsed: false }, 20).detail!, /Sunlit, but the sky here is too bright to see it\./);
  assert.match(describe(25544, { elevation: 4 }).detail!, /Too low in the sky to see from here right now\./);
});
