import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCensus, parseCsvLine, parseEsri } from "../functions/_lib/geocode.ts";
import { bloomingtonIncidents, brooklynParkIncidents, rosemountBlock, rosemountCategory, rosemountIncidents, duluthIncidents, eaganIncidents, logisIncidents, mplsIncidents, onRequestGet, stPaulIncidents, stPaulStreet } from "../functions/api/crime.ts";
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

test("handler combines every city, and rides out any of them being down", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify({ features: [fixtureFor(url)] }))) as typeof fetch;
    const all = await onRequestGet();
    assert.equal(all.status, 200);
    assert.match(all.headers.get("cache-control")!, /max-age=1800/);
    const allBody = await all.json() as { incidents: unknown[]; failed?: unknown };
    assert.equal(allBody.incidents.length, 3);
    assert.equal(allBody.failed, undefined, "nothing failed, nothing reported");

    globalThis.fetch = (async (url: string) => String(url).includes("afSMGVsC7QlRK1kZ")
      ? new Response("down", { status: 503 })
      : new Response(JSON.stringify({ features: [fixtureFor(url)] }))) as typeof fetch;
    const oneDown = await onRequestGet();
    assert.equal(oneDown.status, 200, "one city down still answers with the others' data");
    const oneDownBody = await oneDown.json() as { incidents: unknown[]; failed?: { city: string }[] };
    assert.equal(oneDownBody.incidents.length, 2);
    assert.deepEqual(oneDownBody.failed?.map((f) => f.city), ["Minneapolis"], "the response names the city that failed");
    assert.match(oneDown.headers.get("cache-control")!, /max-age=90\b/, "a partial answer is retried soon, not kept for half an hour");

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

test("logisIncidents keeps rows with a case, date and point, and reads either spelling of the category field", () => {
  const out = logisIncidents("Brooklyn Center", "bc", [
    { attributes: { CaseNumber: "22003146", DateReported: 1_700_000_000_000, Address: "64XX JAMES CIR N", CategoryDecription: "Theft From Building", Neighborhoods: "Shingle Creek" }, geometry: { x: -93.3, y: 45.07 } },
    { attributes: { CaseNumber: "22003147", DateReported: 1_700_000_000_000 } }, // no point
    { attributes: { DateReported: 1_700_000_000_000 }, geometry: { x: -93.3, y: 45.07 } }, // no case number
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].city, "Brooklyn Center");
  assert.equal(out[0].category, "Theft From Building");
  assert.equal(out[0].neighborhood, "Shingle Creek");
  assert.deepEqual(out[0].position, [-93.3, 45.07]);
  const mg = logisIncidents("Maple Grove", "mg", [{ attributes: { CaseNumber: "C1", DateReported: 0, CategoryDescription: "Shoplifting" }, geometry: { x: -93.47, y: 45.13 } }]);
  assert.equal(mg[0].category, "Shoplifting");
});

test("logisIncidents with maskExact reduces Maple Grove's exact address and point to the block", () => {
  const [i] = logisIncidents("Maple Grove", "mg", [{ attributes: { CaseNumber: "C1", DateReported: 0, Address: "9875 HOSPITAL DR N", CategoryDescription: "Shoplifting" }, geometry: { x: -93.47961, y: 45.13364 } }], true);
  assert.equal(i.block, "9800 BLK HOSPITAL DR N");
  assert.notDeepEqual(i.position, [-93.47961, 45.13364]);
});

test("two offense rows on one LOGIS case get different ids", () => {
  const row = { attributes: { CaseNumber: "C1", DateReported: 5, CategoryDescription: "Shoplifting" }, geometry: { x: -93.47, y: 45.13 } };
  const out = logisIncidents("Maple Grove", "mg", [row, row]);
  assert.notEqual(out[0].id, out[1].id);
});

test("eaganIncidents masks the exact address to its hundred-block and snaps the point to a block-sized cell", () => {
  const exact = { x: -93.12345, y: 44.80123 };
  const [i] = eaganIncidents([{ attributes: { OBJECTID: 1, offenseid: "EA21000592", nibrsdesc: "Shoplifting", fulladdr: "3035 POPPLER LN", reportdate: 1_700_000_000_000 }, geometry: exact }]);
  assert.equal(i.block, "3000 BLK POPPLER LN");
  assert.notDeepEqual(i.position, [exact.x, exact.y]);
  assert.ok(Math.abs(i.position![0] - exact.x) <= 0.001 && Math.abs(i.position![1] - exact.y) <= 0.001);
});

test("eaganIncidents leaves an intersection alone and drops rows with no offense description", () => {
  const out = eaganIncidents([
    { attributes: { OBJECTID: 1, offenseid: "EA1", nibrsdesc: "Simple Assault", fulladdr: "INTERSTATE 494 EB / 35E", AddressMask: "Intersection", reportdate: 0 }, geometry: { x: -93.09, y: 44.86 } },
    { attributes: { OBJECTID: 2, offenseid: "EA2", fulladdr: "1 MAIN ST", reportdate: 0 }, geometry: { x: -93.09, y: 44.86 } },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].block, "INTERSTATE 494 EB / 35E");
});

test("stPaulStreet turns a masked block into the middle of its hundred-block", () => {
  assert.equal(stPaulStreet("10XX 4TH ST E"), "1050 4TH ST E");
  assert.equal(stPaulStreet("XX EXCHANGE ST E"), "50 EXCHANGE ST E");
  assert.equal(stPaulStreet("6XX 7TH ST W"), "650 7TH ST W");
  assert.equal(stPaulStreet("1200 GRAND AVE"), "1200 GRAND AVE");
});

test("stPaulIncidents puts an incident on its geocoded block, and leaves the rest on their district", () => {
  const row = (id: number, block: string) => ({ attributes: { ObjectId: id, CASE_NUMBER: id, DATE: 0, NEIGHBORHOOD_NUMBER: 5, INCIDENT_TYPE: "Theft", BLOCK: block } });
  const out = stPaulIncidents([row(1, "6XX 7TH ST W"), row(2, "9XX NOWHERE ST")], new Map([["6XX 7TH ST W", [-93.1, 44.94] as [number, number]]]));
  assert.deepEqual(out[0].position, [-93.1, 44.94]);
  assert.equal(out[1].position, undefined);
  assert.equal(out[1].stpaulDistrict, 5);
});

test("parseCsvLine keeps the quoted lon,lat pair together", () => {
  assert.deepEqual(parseCsvLine('"1","9321 PENN AVE S, Bloomington, MN, ","Match","Exact","9321 PENN AVE S","-93.30,44.83","43595578","L"'),
    ["1", "9321 PENN AVE S, Bloomington, MN, ", "Match", "Exact", "9321 PENN AVE S", "-93.30,44.83", "43595578", "L"]);
});

test("parseCensus keeps matches only", () => {
  const out = parseCensus('"1","a","Match","Exact","A","-93.3,44.8","1","L"\n"2","b","No_Match"\n"3","c","Tie"');
  assert.deepEqual([...out], [["1", [-93.3, 44.8]]]);
});

test("parseEsri maps ResultID back to the input id and drops low scores", () => {
  const out = parseEsri([
    { attributes: { ResultID: 2, Score: 100 }, location: { x: -93.3, y: 44.8 } },
    { attributes: { ResultID: 1, Score: 40 }, location: { x: -93.2, y: 44.9 } },
    { attributes: { ResultID: 3, Score: 0 } },
  ], ["a", "b", "c"]);
  assert.deepEqual([...out], [["b", [-93.3, 44.8]]]);
});

test("bloomingtonIncidents keeps charged offenses, strips the statute, masks to the block, and drops what couldn't be placed", () => {
  const row = (id: number, addr: string, desc: string) => ({ attributes: { OBJECTID: id, CaseNumber: `BP${id}`, dateReported: 0, IncidentAddress: addr, ViolationCodeReference_Desc: desc } });
  const located = new Map<string, [number, number]>([["9321 PENN AVE S", [-93.30852, 44.83479]], ["1 MAIN ST", [-93.2, 44.8]]]);
  const out = bloomingtonIncidents([
    row(1, "9321 PENN AVE S", "609.595.1(4) Damage to Property - 1st Degree - Value Reduced Over $1000"),
    row(2, "1 MAIN ST", "MISWA MISC OFCR WARRANT ARREST"), // not an offense
    row(3, "1 MAIN ST", "ACPD ACC-MOTOR VEHICLE PROPERTY DAMAGE"), // a crash
    row(4, "55 NOWHERE LN", "609.52.2(a)(1) Theft-Take/Use/Transfer Movable Prop-No Consent"), // not geocoded
  ], located);
  assert.equal(out.length, 1);
  assert.equal(out[0].city, "Bloomington");
  assert.equal(out[0].category, "Damage to Property - 1st Degree - Value Reduced Over $1000");
  assert.equal(out[0].block, "9300 BLK PENN AVE S");
  assert.notDeepEqual(out[0].position, [-93.30852, 44.83479]);
});

test("brooklynParkIncidents snaps the point to a block, keeps the neighborhood, and drops traffic and accident rows", () => {
  const row = (id: number, desc: string) => ({
    attributes: { OBJECTID: id, CASE_NUM: `2026-0000${id}`, DATETIME_RPT: 1_700_000_000_000, CRIME_CODE_DESCRIPTION: desc, Neighborhood: "Village Creek" },
    geometry: { x: -93.35306596, y: 45.08802972 },
  });
  const out = brooklynParkIncidents([row(1, "Shoplifting"), row(2, "Misc/Traffic/Other Violation"), { attributes: { OBJECTID: 3, CASE_NUM: "x", DATETIME_RPT: 0, CRIME_CODE_DESCRIPTION: "Theft" } }]);
  assert.equal(out.length, 1, "the traffic row and the one with no point are dropped");
  assert.equal(out[0].city, "Brooklyn Park");
  assert.equal(out[0].neighborhood, "Village Creek");
  assert.notDeepEqual(out[0].position, [-93.35306596, 45.08802972]);
  assert.ok(Math.abs(out[0].position![0] + 93.35306596) <= 0.001 && Math.abs(out[0].position![1] - 45.08802972) <= 0.001);
});

test("rosemountBlock reads the city's block wording and drops an unknown address", () => {
  assert.equal(rosemountBlock("13200-Block Clayton Ave"), "13200 BLK Clayton Ave");
  assert.equal(rosemountBlock("Pine Bend Trl / Courthouse Blvd Wb"), "Pine Bend Trl / Courthouse Blvd Wb");
  assert.equal(rosemountBlock("Street Info Not Available"), undefined);
  assert.equal(rosemountBlock(undefined), undefined);
});

test("rosemountCategory tidies dispatch wording", () => {
  assert.equal(rosemountCategory("Theft RPT", "Theft"), "Theft");
  assert.equal(rosemountCategory("Fraud Activity RPT ", "Fraud"), "Fraud Activity");
  assert.equal(rosemountCategory("Vandalism/Property Damage", "Vandalism"), "Vandalism/Property Damage");
  assert.equal(rosemountCategory(undefined, "Theft"), "Theft");
});

test("rosemountIncidents keeps real offenses and drops traffic, animal and non-criminal calls, sensitive rows and other cities", () => {
  const row = (id: number, o: Partial<{ problem: string; cat: string; sensitive: string; city: string }> = {}) => ({
    attributes: { OBJECTID: id, masterincnum: `RS26-${id}`, responsedate: 1_700_000_000_000, fulladdress: "13200-Block Clayton Ave", problem: o.problem ?? "Theft RPT", problem_category: o.cat ?? "Theft", sensitive: o.sensitive ?? "No", city: o.city ?? "ROSEMOUNT" },
    geometry: { x: -93.0288, y: 44.7507 },
  });
  const out = rosemountIncidents([
    row(1),
    row(2, { problem: "Traffic Stop", cat: "Traffic Incident" }),
    row(3, { problem: "Suspicious Activity", cat: "Other - Non Criminal" }),
    row(4, { problem: "Animal Calls", cat: "Animal Calls" }),
    row(5, { problem: "Domestic/Disputes RPT", cat: "Domestic Assault", sensitive: "Yes" }),
    row(6, { city: "APPLE VALLEY" }),
    row(7, { problem: "Vandalism/Property Damage", cat: "Vandalism" }),
    { attributes: { OBJECTID: 8, masterincnum: "x", responsedate: 0, problem: "Theft RPT", problem_category: "Theft", sensitive: "No", city: "ROSEMOUNT" } }, // no point
  ]);
  assert.deepEqual(out.map((i) => i.category), ["Theft", "Vandalism/Property Damage"]);
  assert.equal(out[0].city, "Rosemount");
  assert.equal(out[0].block, "13200 BLK Clayton Ave");
  assert.deepEqual(out[0].position, [-93.0288, 44.7507]);
});
