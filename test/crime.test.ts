import { test } from "node:test";
import assert from "node:assert/strict";
import { duluthIncidents, mplsIncidents, onRequestGet, stPaulIncidents } from "../functions/api/crime.ts";
import { crimePosition, crimeStrength, describeCrime, FADE_DAYS, previewCrime, type StPaulDistricts } from "../src/crime/crime.ts";

// --- functions/api/crime.ts: normalizing each city's raw rows ---------------------

test("mplsIncidents keeps rows with a point and a case number, drops the rest", () => {
  const out = mplsIncidents([
    { attributes: { OBJECTID: 1, caseNumber: "MP1", description: "Auto Theft", reportedDateTime: 1_700_000_000_000, centerLat: 44.9, centerLong: -93.3, neighborhood: "Howe", publicaddress: "0038XX 37TH AVE S" } },
    { attributes: { OBJECTID: 2, caseNumber: "MP2", reportedDateTime: 1_700_000_000_000 } }, // no coordinates
    { attributes: { OBJECTID: 3, centerLat: 44.9, centerLong: -93.3, reportedDateTime: 1_700_000_000_000 } }, // no case number
    { attributes: { caseNumber: "MP4", centerLat: 44.9, centerLong: -93.3, reportedDateTime: 1_700_000_000_000 } }, // no OBJECTID
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "mpls-MP1-1");
  assert.equal(out[0].city, "Minneapolis");
  assert.equal(out[0].category, "Auto Theft");
  assert.deepEqual(out[0].position, [-93.3, 44.9]);
  assert.equal(out[0].reportedAt, 1_700_000_000);
});

test("mplsIncidents falls back to the offense code when there's no plain description", () => {
  const out = mplsIncidents([{ attributes: { OBJECTID: 1, caseNumber: "MP1", offense: "AUTOTH", reportedDateTime: 0, centerLat: 44.9, centerLong: -93.3 } }]);
  assert.equal(out[0].category, "AUTOTH");
});

test("mplsIncidents gives each offense on the same case its own id, so they never collide on hover", () => {
  const out = mplsIncidents([
    { attributes: { OBJECTID: 1, caseNumber: "MP1", description: "Assault", reportedDateTime: 0, centerLat: 44.9, centerLong: -93.3 } },
    { attributes: { OBJECTID: 2, caseNumber: "MP1", description: "Burglary", reportedDateTime: 0, centerLat: 44.9, centerLong: -93.3 } },
  ]);
  assert.notEqual(out[0].id, out[1].id);
});

test("stPaulIncidents keeps rows with a case, date and district, drops the rest", () => {
  const out = stPaulIncidents([
    { attributes: { ObjectId: 1, CASE_NUMBER: 26175684, DATE: 1_700_000_000_000, INCIDENT_TYPE: "Narcotics", NEIGHBORHOOD_NUMBER: 17, NEIGHBORHOOD_NAME: "17 - Capitol River", BLOCK: "XX EXCHANGE ST E" } },
    { attributes: { ObjectId: 2, CASE_NUMBER: 2, DATE: 1_700_000_000_000 } }, // no district
    { attributes: { ObjectId: 3, NEIGHBORHOOD_NUMBER: 5, DATE: 1_700_000_000_000 } }, // no case number
    { attributes: { CASE_NUMBER: 4, NEIGHBORHOOD_NUMBER: 5, DATE: 1_700_000_000_000 } }, // no ObjectId
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "stp-26175684-1");
  assert.equal(out[0].city, "Saint Paul");
  assert.equal(out[0].category, "Narcotics");
  assert.equal(out[0].stpaulDistrict, 17);
  assert.equal(out[0].position, undefined);
});

test("proactive police visits are officers' own patrol stops, not crimes, and are dropped", () => {
  const out = stPaulIncidents([
    { attributes: { ObjectId: 1, CASE_NUMBER: 1, DATE: 0, NEIGHBORHOOD_NUMBER: 5, INCIDENT_TYPE: "POLICE VISIT-PROACTIVE POLICE VISIT", INCIDENT: "Proactive Police Visit" } },
    { attributes: { ObjectId: 2, CASE_NUMBER: 2, DATE: 0, NEIGHBORHOOD_NUMBER: 5, INCIDENT_TYPE: "Theft" } },
  ]);
  assert.deepEqual(out.map((i) => i.category), ["Theft"]);
  assert.equal(mplsIncidents([{ attributes: { OBJECTID: 1, caseNumber: "MP1", description: "Proactive Police Visit", reportedDateTime: 0, centerLat: 44.9, centerLong: -93.3 } }]).length, 0);
});

test("stPaulIncidents strips the leading district number off the neighborhood name", () => {
  const out = stPaulIncidents([{ attributes: { ObjectId: 1, CASE_NUMBER: 1, DATE: 0, NEIGHBORHOOD_NUMBER: 17, NEIGHBORHOOD_NAME: "17 - Capitol River" } }]);
  assert.equal(out[0].neighborhood, "Capitol River");
});

test("duluthIncidents keeps rows with a case, date and a point, drops the rest", () => {
  const out = duluthIncidents([
    { attributes: { OBJECTID: 1, Case_Number: "02026-1", Crime_Description: "Trespass of Real Property", Reported_DateTime: 1_700_000_000_000, Latitude: 46.78, Longitude: -92.1, BlockAddress: "300 BLK W Superior St" } },
    { attributes: { OBJECTID: 2, Case_Number: "02026-2", Reported_DateTime: 1_700_000_000_000 } }, // no point
    { attributes: { Case_Number: "02026-3", Reported_DateTime: 1_700_000_000_000, Latitude: 46.78, Longitude: -92.1 } }, // no OBJECTID
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "duluth-02026-1-1");
  assert.equal(out[0].city, "Duluth");
  assert.equal(out[0].category, "Trespass of Real Property");
  assert.deepEqual(out[0].position, [-92.1, 46.78]);
});

function fixtureFor(url: string) {
  if (String(url).includes("afSMGVsC7QlRK1kZ")) return { attributes: { OBJECTID: 1, caseNumber: "MP1", description: "Theft", reportedDateTime: 0, centerLat: 44.9, centerLong: -93.3 } };
  if (String(url).includes("9meaaHE3uiba0zr8")) return { attributes: { ObjectId: 1, CASE_NUMBER: 1, DATE: 0, INCIDENT_TYPE: "Theft", NEIGHBORHOOD_NUMBER: 1 } };
  return { attributes: { OBJECTID: 1, Case_Number: "D1", Crime_Description: "Theft", Reported_DateTime: 0, Latitude: 46.78, Longitude: -92.1 } };
}

test("handler combines all three cities, and rides out any of them being down", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify({ features: [fixtureFor(url)] }))) as typeof fetch;
    const all = await onRequestGet();
    assert.equal(all.status, 200);
    assert.match(all.headers.get("cache-control")!, /max-age=1800/);
    const allBody = await all.json() as { incidents: unknown[] };
    assert.equal(allBody.incidents.length, 3);

    globalThis.fetch = (async (url: string) => String(url).includes("afSMGVsC7QlRK1kZ")
      ? new Response("down", { status: 503 })
      : new Response(JSON.stringify({ features: [fixtureFor(url)] }))) as typeof fetch;
    const oneDown = await onRequestGet();
    assert.equal(oneDown.status, 200, "one city down still answers with the others' data");
    const oneDownBody = await oneDown.json() as { incidents: unknown[] };
    assert.equal(oneDownBody.incidents.length, 2);

    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    assert.equal((await onRequestGet()).status, 502, "every city down is a clear failure");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- src/crime/crime.ts: fading, phrasing, placement -------------------------------

const MPLS_INCIDENT = { id: "mpls-1", city: "Minneapolis" as const, category: "Auto Theft", reportedAt: 0, position: [-93.3, 44.9] as [number, number] };

test("crimeStrength is full when just reported, fades linearly, and bottoms out at 0", () => {
  assert.equal(crimeStrength(MPLS_INCIDENT, 0), 1);
  assert.ok(crimeStrength(MPLS_INCIDENT, FADE_DAYS.Minneapolis * 86_400 * 0.5) < 1);
  assert.equal(crimeStrength(MPLS_INCIDENT, FADE_DAYS.Minneapolis * 86_400 * 2), 0);
});

test("Duluth's much longer fade window is used for a Duluth incident", () => {
  const duluth = { id: "duluth-1", city: "Duluth" as const, category: "Vandalism", reportedAt: 0, position: [-92.1, 46.78] as [number, number] };
  // Old enough to have fully faded under the Twin Cities' 2-day window, but not Duluth's 12-day one.
  const ageS = 5 * 86_400;
  assert.equal(crimeStrength(MPLS_INCIDENT, ageS), 0, "sanity: a Twin Cities incident this old is gone");
  assert.ok(crimeStrength(duluth, ageS) > 0, "a Duluth incident this old is still showing");
});

test("describeCrime unmasks the block number and names the city", () => {
  const d = describeCrime({ ...MPLS_INCIDENT, block: "0038XX 37TH AVE S", neighborhood: "Howe" }, 3600);
  assert.equal(d.title, "Auto Theft, 3800 block 37TH AVE S, Howe.");
  assert.match(d.detail!, /Reported .* in Minneapolis\./);
  assert.equal(d.meta, "Minneapolis");
});

test("describeCrime turns Duluth's \"BLK\" into \"block\" too", () => {
  const d = describeCrime({ id: "duluth-1", city: "Duluth", category: "Vandalism", reportedAt: 0, block: "300 BLK W Superior St" }, 3600);
  assert.equal(d.title, "Vandalism, 300 block W Superior St.");
});

test("previewCrime serves one recent incident for the known spec and nothing else", () => {
  const body = previewCrime("preview");
  assert.ok(body);
  assert.equal(body!.incidents.length, 1);
  assert.equal(body!.incidents[0].city, "Minneapolis");
  const duluth = previewCrime("preview-duluth");
  assert.ok(duluth);
  assert.equal(duluth!.incidents[0].city, "Duluth");
  assert.equal(previewCrime("nope"), undefined);
  assert.equal(previewCrime(""), undefined);
});

test("crimePosition uses Minneapolis's own point directly", () => {
  assert.deepEqual(crimePosition(MPLS_INCIDENT, {}), [-93.3, 44.9]);
});

const DISTRICTS: StPaulDistricts = { 17: { name: "Downtown", center: [-93.09, 44.95], radiusM: 900 } };

test("crimePosition jitters a Saint Paul incident inside its real district, stably across calls", () => {
  const stp = { id: "stp-1", city: "Saint Paul" as const, category: "Narcotics", reportedAt: 0, stpaulDistrict: 17 };
  const a = crimePosition(stp, DISTRICTS);
  const b = crimePosition(stp, DISTRICTS);
  assert.deepEqual(a, b, "the same incident always lands on the same spot");
  const kx = 111_320 * Math.cos((44.95 * Math.PI) / 180);
  const dM = Math.hypot((a![0] - -93.09) * kx, (a![1] - 44.95) * 111_320);
  assert.ok(dM <= 900, `${dM}m from the district center, expected within its 900m radius`);
});

test("crimePosition gives two different Saint Paul incidents different spots", () => {
  const a = crimePosition({ id: "stp-1", city: "Saint Paul" as const, category: "x", reportedAt: 0, stpaulDistrict: 17 }, DISTRICTS);
  const b = crimePosition({ id: "stp-2", city: "Saint Paul" as const, category: "x", reportedAt: 0, stpaulDistrict: 17 }, DISTRICTS);
  assert.notDeepEqual(a, b);
});

test("crimePosition gives nothing for a Saint Paul incident whose district never loaded", () => {
  const stp = { id: "stp-1", city: "Saint Paul" as const, category: "x", reportedAt: 0, stpaulDistrict: 99 };
  assert.equal(crimePosition(stp, DISTRICTS), undefined);
  assert.equal(crimePosition(stp, {}), undefined);
});
