import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseIncidents } from "../functions/api/incidents.ts";
import { describeIncident, dirWord, formatRoad, incidentWord, previewIncidents } from "../src/traffic/incidents.ts";

const FIXTURE = `<?xml version='1.0' encoding='UTF-8'?>
<active_incidents time_stamp='Sun Sep 27 13:22:07 CDT 2026'>
<incident name='L004_15760103' event_type='INCIDENT_CRASH' event_date='Sun Sep 27 13:10:33 CDT 2026' lane_code='Mainline' road='T.H.101' dir='SB' lon='-93.55764' lat='45.29212' camera='C653' impact='....' cleared='false' confirmed='false'/>
<incident name='2026092712582312' event_type='INCIDENT_CRASH' event_date='Sun Sep 27 12:58:23 CDT 2026' lane_code='Mainline' road='I-494' dir='EB' location='12th Ave' lon='-93.25799' lat='44.86212' camera='C418' impact='.....' cleared='false' confirmed='false'/>
<incident name='2026092712525316' event_type='INCIDENT_HAZARD' event_date='Sun Sep 27 12:52:53 CDT 2026' detail='Vehicle Fire' lane_code='Mainline' road='I-35W' dir='NB' lon='-93.04881' lat='45.20282' camera='C649' impact='....' cleared='false' confirmed='false'/>
<incident name='OLD001' event_type='INCIDENT_STALL' event_date='Sun Sep 27 12:00:00 CDT 2026' lane_code='Mainline' road='I-94' dir='WB' lon='-93.2' lat='44.9' camera='C1' impact='.' cleared='true' confirmed='false'/>
<incident name='FAR001' event_type='INCIDENT_STALL' event_date='Sun Sep 27 12:00:00 CDT 2026' lane_code='Mainline' road='I-90' dir='WB' lon='-96.5' lat='43.9' camera='C2' impact='.' cleared='false' confirmed='false'/>
</active_incidents>`;

test("parseIncidents keeps active metro incidents, drops cleared ones and ones far outside the metro", () => {
  const body = parseIncidents(FIXTURE);
  assert.equal(body.incidents.length, 3);
  const ids = body.incidents.map((x) => x.id);
  assert.ok(!ids.includes("OLD001"), "cleared incident should be dropped");
  assert.ok(!ids.includes("FAR001"), "far-outside-metro incident should be dropped");
});

test("parseIncidents carries the road, direction, location and a specific detail when MnDOT gives one", () => {
  const body = parseIncidents(FIXTURE);
  const fire = body.incidents.find((x) => x.id === "2026092712525316")!;
  assert.equal(fire.detail, "Vehicle Fire");
  assert.equal(fire.road, "I-35W");
  assert.equal(fire.dir, "NB");
  const crash = body.incidents.find((x) => x.id === "2026092712582312")!;
  assert.equal(crash.location, "12th Ave");
  assert.deepEqual(crash.position, [-93.25799, 44.86212]);
});

test("handler returns JSON with a cache header, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    const gz = new Blob([FIXTURE]).stream().pipeThrough(new CompressionStream("gzip"));
    const gzBytes = await new Response(gz).arrayBuffer();
    globalThis.fetch = (async () => new Response(gzBytes)) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=30/);
    const body = await ok.json() as { incidents: unknown[] };
    assert.equal(body.incidents.length, 3);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: phrasing ---------------------------------------------------------

test("formatRoad reads T.H. and U.S. prefixes as \"Highway N\"; interstates stay as-is", () => {
  assert.equal(formatRoad("T.H.101"), "Highway 101");
  assert.equal(formatRoad("U.S.169"), "Highway 169");
  assert.equal(formatRoad("I-494"), "I-494");
});

test("dirWord and incidentWord read as plain English", () => {
  assert.equal(dirWord("EB"), "eastbound");
  assert.equal(dirWord("SB"), "southbound");
  assert.equal(incidentWord("INCIDENT_CRASH"), "Crash");
  assert.equal(incidentWord("INCIDENT_STALL"), "Stalled vehicle");
  assert.equal(incidentWord("INCIDENT_SOMETHING_NEW"), "Incident");
});

test("describeIncident reads as a plain sentence, prefers a specific detail, and ages the report", () => {
  const d = describeIncident({ id: "x", type: "INCIDENT_CRASH", road: "I-494", dir: "EB", location: "12th Ave", position: [0, 0], at: 0 }, 12 * 60);
  assert.equal(d.title, "Crash on I-494 eastbound near 12th Ave.");
  assert.match(d.detail!, /Reported 12 minutes ago/);

  const fire = describeIncident({ id: "y", type: "INCIDENT_HAZARD", detail: "Vehicle Fire", road: "I-35W", dir: "NB", position: [0, 0], at: 0 }, 60);
  assert.equal(fire.title, "Vehicle Fire on I-35W northbound.");
});

test("previewIncidents serves each known spec, timestamped in the recent past, and nothing unknown", () => {
  for (const key of ["crash", "stall", "hazard", "roadwork"]) {
    const body = previewIncidents(key);
    assert.ok(body, key);
    assert.equal(body!.incidents.length, 1);
    assert.ok(body!.t - body!.incidents[0].at > 0);
  }
  assert.equal(previewIncidents("not-a-real-type"), undefined);
  assert.equal(previewIncidents(""), undefined);
});
