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
  assert.match(meteor.detail!, /^A Meteor weather satellite, from Russia,/);
  assert.match(meteor.detail!, /from Vostochny, Russia\./);
});

test("Tiangong and a Starlink", () => {
  const css = describe(48274);
  assert.equal(css.title, "Tiangong space station.");
  assert.match(css.detail!, /^China's crewed space station/);
  assert.match(css.detail!, /third country to build and staff its own space station/);
  assert.match(css.detail!, /from Wenchang, China\./);
  assert.match(describe(68149).detail!, /^A SpaceX Starlink internet satellite, from the United States\./);
  assert.match(describe(68149).detail!, /largest satellite constellation ever built/);
  assert.match(describe(68149).detail!, /Launched March 13, 2026 from Vandenberg, California\./);
});

test("the ISS's extra history, and Hubble's own story appended after the facts", () => {
  assert.match(describe(25544).detail!, /largest human-made structure ever put in space/);

  const hst = describeSatellite({
    id: 20580, name: "HST", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OWNER: "US" },
  });
  assert.match(hst.detail!, /^A satellite from the United States\./);
  assert.match(hst.detail!, /Space Shuttle in 1990/);
  assert.match(hst.detail!, /flawed mirror/);
});

test("whether you could see it", () => {
  assert.match(describe(25544, { eclipsed: false, elevation: 34, azimuth: 247 }).detail!, /Visible to the eye right now: look west-southwest, 34° above the horizon\./);
  assert.match(describe(25544, { eclipsed: false }, 20).detail!, /Sunlit, but the sky here is too bright to see it\./);
  assert.match(describe(25544, { elevation: 4 }).detail!, /Too low in the sky to see from here right now\./);
});

test("debris: kinds, and each cloud's origin story", () => {
  assert.equal(kindOf({ id: 29228, name: "FENGYUN 1C DEB" }), "debris");
  assert.equal(kindOf({ id: 25730, name: "FENGYUN 1C" }), "debris", "what's left of the parent is debris too");
  assert.equal(kindOf({ id: 33772, name: "COSMOS 2251 DEB" }), "debris");
  assert.equal(kindOf({ id: 24946, name: "IRIDIUM 33 DEB" }), "debris");
  assert.equal(kindOf({ id: 43571, name: "IRIDIUM 140" }), "satellite", "working Iridiums aren't debris");

  const frag = describeSatellite({
    id: 29228, name: "FENGYUN 1C DEB", kind: "debris", sunElevation: -20,
    live: { lon: -93.2, lat: 44.9, altKm: 850, speedKms: 7.43, elevation: 50, azimuth: 90, eclipsed: false },
    catalog: { OBJECT_ID: "1999-025BX", PERIOD: 101.2, INCLINATION: 98.8, APOGEE: 880, PERIGEE: 820, RCS: 0.05 },
  });
  assert.equal(frag.title, "A fragment of Fengyun-1C.");
  assert.match(frag.detail!, /^Space debris from a Chinese weather satellite that China destroyed with a missile in a January 2007 anti-satellite test/);
  assert.match(frag.detail!, /Low Earth orbit: circles the planet every 101 minutes, tilted 98\.8° to the equator\. Now 528 miles up, moving at 16,600 mph\. Far too small to see with the eye\.$/);
  assert.equal(frag.meta, "NORAD 29228 · 1999-025BX · radar size small");

  const collision = describeSatellite({ id: 33772, name: "COSMOS 2251 DEB", kind: "debris", sunElevation: 10,
    live: { lon: 0, lat: 0, altKm: 700, speedKms: 7.5, elevation: 40, azimuth: 0, eclipsed: true } });
  assert.equal(collision.title, "A fragment of Cosmos 2251.");
  assert.match(collision.detail!, /the first accidental collision between two satellites/);

  const parent = describeSatellite({ id: 25730, name: "FENGYUN 1C", kind: "debris", sunElevation: 10,
    live: { lon: 0, lat: 0, altKm: 850, speedKms: 7.4, elevation: 40, azimuth: 0, eclipsed: true } });
  assert.equal(parent.title, "What remains of Fengyun-1C.");
});

const livePos = (over: Partial<SatPosition> = {}): SatPosition => ({
  lon: -93.2, lat: 44.9, altKm: 550, speedKms: 7.5, elevation: 50, azimuth: 90, eclipsed: false, ...over,
});

test("a rocket body reads as the spent stage, not a mystery payload", () => {
  const d = describeSatellite({
    id: 40889, name: "FALCON 9 R/B", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OBJECT_TYPE: "R/B", OBJECT_ID: "2015-050B", PERIOD: 95, INCLINATION: 51.6, APOGEE: 600, PERIGEE: 580, RCS: 8 },
  });
  assert.equal(d.title, "Falcon 9 rocket stage.");
  assert.match(d.detail!, /^A spent rocket stage, still coasting in the orbit it delivered its payload to\./);
  assert.match(d.detail!, /Now 342 miles up, moving at 16,800 mph\.$/);
  assert.equal(d.meta, "NORAD 40889 · 2015-050B · radar size large");

  const cz = describeSatellite({
    id: 12345, name: "CZ-4C R/B", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OBJECT_TYPE: "R/B", APOGEE: 700, PERIGEE: 690 },
  });
  assert.equal(cz.title, "Long March 4 rocket stage.");
});

test("with no route to a purpose, the orbit itself suggests one, hedged as trackers' belief", () => {
  const geo = describeSatellite({
    id: 1, name: "MYSTERY GEO 1", kind: "satellite", sunElevation: 10, live: livePos({ altKm: 35_786 }),
    catalog: { OWNER: "US", APOGEE: 35_790, PERIGEE: 35_780, INCLINATION: 0.1, PERIOD: 1436 },
  });
  assert.match(geo.detail!, /A satellite from the United States\./);
  assert.match(geo.detail!, /geostationary orbit like this is typically used for communications, weather-watching, or military relay\./);

  const sunsync = describeSatellite({
    id: 2, name: "USA 999", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OWNER: "US", APOGEE: 700, PERIGEE: 680, INCLINATION: 98 },
  });
  assert.match(sunsync.detail!, /sun-synchronous, low orbit is the pattern trackers associate with Earth-imaging or reconnaissance satellites\./);

  const molniya = describeSatellite({
    id: 3, name: "COSMOS 2500", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OWNER: "CIS", APOGEE: 39_000, PERIGEE: 600, INCLINATION: 63.4 },
  });
  assert.match(molniya.detail!, /lingering for hours over the far north.*missile-warning and high-latitude communications/);

  const plainLeo = describeSatellite({
    id: 4, name: "MYSTERY LEO 1", kind: "satellite", sunElevation: 10, live: livePos(),
    catalog: { OWNER: "US", APOGEE: 800, PERIGEE: 780, INCLINATION: 30 },
  });
  assert.match(plainLeo.detail!, /communications, navigation or scientific research; its precise mission isn't publicly documented\./);

  // Nothing at all to classify by: no purpose guess is invented from thin air.
  const noOrbit = describeSatellite({ id: 5, name: "MYSTERY 5", kind: "satellite", sunElevation: 10, live: livePos(), catalog: { OWNER: "US" } });
  assert.equal(noOrbit.detail, "A satellite from the United States. Now 342 miles up, moving at 16,800 mph. Sunlit, but the sky here is too bright to see it.");
});
