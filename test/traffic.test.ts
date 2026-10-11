import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describeStation, level, parseSample, parseStamp, routeName } from "../src/traffic/traffic.ts";
import { parseFreeways } from "../src/traffic/freeways.ts";
import { gunzipText } from "../functions/api/traffic.ts";

const gz = readFileSync(new URL("./fixtures/mndot-stat.xml.gz", import.meta.url));

test("describeStation says so when a speed is an estimate borrowed from nearby sensors", () => {
  const d = describeStation({ label: "Shepard Rd", limit: 55, lanes: 3, route: "I-35E", dir: "SB" }, [52, 900], 30, true);
  assert.match(d.detail!, /estimated from nearby sensors/);
  assert.match(d.detail!, /52 mph/);
});

test("reads MnDOT's 30-second sample", () => {
  const r = parseSample(new TextDecoder().decode(gunzipSync(gz)));
  assert.ok(Object.keys(r.s).length > 1000, `${Object.keys(r.s).length} stations`);
  assert.deepEqual(r.s.S779, [57, 990]);
  assert.equal(r.t, parseStamp("Sat Sep 26 18:42:00 CDT 2026"));
});

test("the endpoint's gunzip matches Node's", async () => {
  const ab = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
  assert.equal(await gunzipText(ab), new TextDecoder().decode(gunzipSync(gz)));
});

test("timestamps in central time, daylight and standard", () => {
  assert.equal(new Date(parseStamp("Sat Sep 26 18:42:00 CDT 2026") * 1000).toISOString(), "2026-09-26T23:42:00.000Z");
  assert.equal(new Date(parseStamp("Tue Jan 13 07:05:30 CST 2026") * 1000).toISOString(), "2026-01-13T13:05:30.000Z");
});

test("unknown values are skipped, partial ones kept", () => {
  const r = parseSample("<traffic_sample time_stamp='Sat Sep 26 18:42:00 CDT 2026' period='30'>"
    + "<sample sensor='S1' flow='UNKNOWN' speed='UNKNOWN'/><sample sensor='S2' flow='300'/></traffic_sample>");
  assert.equal(r.s.S1, undefined);
  assert.deepEqual(r.s.S2, [null, 300]);
});

test("traffic levels compare speed with the limit", () => {
  assert.equal(level(60, 60), "free");
  assert.equal(level(45, 55), "free");
  assert.equal(level(40, 60), "slowing");
  assert.equal(level(25, 55), "heavy");
  assert.equal(level(12, 55), "stopped");
});

test("route names in plain words", () => {
  assert.equal(routeName("I-94"), "I-94");
  assert.equal(routeName("U.S.169"), "US 169");
  assert.equal(routeName("T.H.62"), "Highway 62");
  assert.equal(routeName("I-394 Rev"), "I-394 express lanes");
  assert.equal(routeName("I-35W CD"), "I-35W collector road");
});

test("describes a stretch of freeway", () => {
  const d = describeStation({ label: "Lyndale Ave", limit: 55, lanes: 3, route: "I-94", dir: "EB" }, [23, 460], 40);
  assert.equal(d.title, "I-94 eastbound at Lyndale Ave.");
  assert.equal(d.detail, "23 mph, heavy traffic. The limit is 55. About 1,380 vehicles an hour.");
  assert.equal(d.meta, "MnDOT sensor · updated 40 seconds ago");
  const n = describeStation({ label: "N of Co Rd 70", limit: 70, lanes: 2, route: "I-35", dir: "NB" }, [68, 210], 5);
  assert.equal(n.title, "I-35 northbound north of County Road 70.");
  assert.equal(n.detail, "68 mph, moving freely. The limit is 70. About 420 vehicles an hour.");
  assert.equal(describeStation({ label: "T.H.62", limit: 60, lanes: 2, route: "U.S.169", dir: "SB" }, undefined, 0).detail, "No speed reading right now.");
});

test("consecutive segments sharing a station merge into one stretch", () => {
  // Three segments on one line: two share S1, then a gap, then S2.
  const line = "_p~iF~ps|U_ulLnnqC_mqNvxq`@_ulLnnqC_ulLnnqC"; // five points
  const fw = parseFreeways({ stations: {}, corridors: [{ route: "I-94", dir: "EB", line, seg: ["S1", "S1", "", "S2"] }] });
  assert.deepEqual(fw.stretches.map((s) => [s.station, s.path.length]), [["S1", 3], ["S2", 2]]);
});

test("the baked freeway layout covers the metro's main freeways", () => {
  const fw = parseFreeways(JSON.parse(readFileSync(new URL("../public/data/freeways.json", import.meta.url), "utf8")));
  const routes = new Set(Object.values(fw.stations).map((s) => s.route));
  for (const r of ["I-94", "I-35W", "I-35E", "I-494", "I-694", "I-394", "T.H.62", "T.H.100", "U.S.169"]) assert.ok(routes.has(r), `missing ${r}`);
  assert.ok(fw.stretches.length > 1000);
});
