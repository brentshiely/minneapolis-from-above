import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, parseAirport } from "../functions/api/airport.ts";
import { airportPhrase, describeAirport, previewAirport, reasonWord } from "../src/airport.ts";

const FIXTURE = `<AIRPORT_STATUS_INFORMATION><Update_Time>Sun Sep 27 18:31:25 2026 GMT</Update_Time>`
  + `<Delay_type><Name>Ground Stop Programs</Name><Ground_Stop_List><Program><ARPT>BOS</ARPT><Reason>wind</Reason><End_Time>3:30 pm EDT</End_Time></Program></Ground_Stop_List></Delay_type>`
  + `<Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>PHL</ARPT><Reason>wind</Reason><Avg>48 minutes</Avg><Max>2 hours</Max></Ground_Delay></Ground_Delay_List></Delay_type>`
  + `<Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List>`
  + `<Delay><ARPT>LAS</ARPT><Reason>WX:Wind</Reason><Arrival_Departure Type="Departure"><Min>16 minutes</Min><Max>30 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay>`
  + `<Delay><ARPT>MSP</ARPT><Reason>TM Initiatives:MIT:WX</Reason><Arrival_Departure Type="Departure"><Min>15 minutes</Min><Max>29 minutes</Max><Trend>Decreasing</Trend></Arrival_Departure></Delay>`
  + `</Arrival_Departure_Delay_List></Delay_type>`
  + `<Delay_type><Name>Airport Closures</Name><Airport_Closure_List><Airport><ARPT>LAX</ARPT><Reason>runway work</Reason><Start>May 27 at 18:26 UTC.</Start><Reopen>June 1</Reopen></Airport></Airport_Closure_List></Delay_type>`
  + `</AIRPORT_STATUS_INFORMATION>`;

test("parseAirport keeps only MSP entries across every delay type", () => {
  const body = parseAirport(FIXTURE);
  assert.equal(body.status.length, 1);
  const s = body.status[0];
  assert.equal(s.kind, "delay");
  if (s.kind === "delay") {
    assert.equal(s.type, "Departure");
    assert.equal(s.min, "15 minutes");
    assert.equal(s.max, "29 minutes");
    assert.equal(s.reason, "TM Initiatives:MIT:WX");
  }
});

test("parseAirport returns an empty list when MSP has nothing active", () => {
  const body = parseAirport(FIXTURE.replace(/MSP/g, "ORD"));
  assert.deepEqual(body.status, []);
});

test("handler returns JSON with a cache header, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(FIXTURE)) as typeof fetch;
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=300/);

    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);

    globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client: plain language ----------------------------------------------------

test("reasonWord reads FAA's terse codes in plain words", () => {
  assert.equal(reasonWord("wind"), "wind");
  assert.equal(reasonWord("TM Initiatives:MIT:WX"), "weather");
  assert.equal(reasonWord("TM Initiatives:MIT"), "traffic management");
  assert.equal(reasonWord("low ceilings"), "low clouds");
  assert.equal(reasonWord("airport volume"), "heavy traffic");
  assert.equal(reasonWord("some new code we've never seen"), "some new code we've never seen");
});

test("airportPhrase is quiet when nothing's active, and picks the worst line when several apply", () => {
  assert.equal(airportPhrase([]), undefined);
  const phrase = airportPhrase([
    { kind: "delay", type: "Departure", reason: "wind", min: "10 minutes", max: "20 minutes", trend: "Increasing" },
    { kind: "ground-stop", reason: "wind", until: "3:30 pm" },
  ]);
  assert.match(phrase!, /^MSP ground stop/);
});

test("describeAirport reads as normal operations when quiet, and lists every active line otherwise", () => {
  const quiet = describeAirport([]);
  assert.equal(quiet.detail, "Normal operations, no delays.");
  const busy = describeAirport([{ kind: "delay", type: "Departure", reason: "wind", min: "10 minutes", max: "20 minutes", trend: "Increasing" }]);
  assert.match(busy.detail!, /Departures delayed 10 minutes to 20 minutes: wind\./);
});

test("previewAirport serves each known spec and nothing for an unknown one", () => {
  for (const key of ["groundstop", "grounddelay", "delay", "closure"]) {
    assert.ok(previewAirport(key), key);
  }
  assert.equal(previewAirport("not-a-real-status"), undefined);
  assert.equal(previewAirport(""), undefined);
});
