/**
 * Cloudflare Pages Function: GET /api/crime
 *
 * Recent reported crime incidents from Minneapolis's, Saint Paul's,
 * Duluth's, Brooklyn Center's, Maple Grove's and Eagan's own open-data
 * services (all Esri FeatureServers/MapServers, free, no key, CORS-open).
 * Brooklyn Center and Maple Grove are served from LOGIS, the shared
 * records-system host for several suburban departments.
 *
 * Researched (Oct 2026): the other inner suburbs and every county sheriff
 * publish no open incident feed. Many (St. Louis Park, Burnsville, Brooklyn
 * Park) use LexisNexis Community Crime Map or Socrata Connect pages, which
 * are display-only with terms that prohibit redistribution -- the same
 * "not authorized for reuse" problem that ruled out 511mn.org's plow data
 * and Blitzortung's lightning feed. Minnetonka has a LOGIS feed too, but it
 * stopped updating in May 2026; add it back if it resumes. The state BCA
 * Crime Data Explorer has only monthly aggregates, not incidents.
 *
 * Every source already truncates location to a block or a police district
 * before publishing, except Eagan, which publishes exact addresses and
 * points: those are masked to the block here (see eaganIncidents).
 * Minneapolis and Saint Paul update roughly daily; Duluth's own dashboard
 * says weekly, and its freshest record is often a week old -- so Duluth
 * uses a much longer lookback and fade than the Twin Cities (see
 * LOOKBACK_DAYS and src/crime/crime.ts's FADE_DAYS). The smaller suburbs
 * report only a few incidents a day and lag a few days, so they get a week.
 */
import { censusBatch, esriBatch, type LonLat } from "../_lib/geocode.ts";

const TTL_S = 1800;
/** When any city's feed failed, how long the partial answer is kept before trying again. */
const RETRY_TTL_S = 90;
/** Fades out client-side over roughly this long; no point asking further back. Duluth updates weekly, so it gets a longer window. */
const LOOKBACK_DAYS: Record<City, number> = { Minneapolis: 3, "Saint Paul": 3, Duluth: 14, "Brooklyn Center": 8, "Maple Grove": 8, Eagan: 8, Bloomington: 8 };

export type City = "Minneapolis" | "Saint Paul" | "Duluth" | "Brooklyn Center" | "Maple Grove" | "Eagan" | "Bloomington";

export interface CrimeIncident {
  id: string;
  city: City;
  /** Plain-language offense/incident category, as the city itself labels it. */
  category: string;
  /** POSIX seconds. */
  reportedAt: number;
  neighborhood?: string;
  /** Already block-truncated by the source; never an exact address. */
  block?: string;
  /** Minneapolis publishes a block-centroid point directly. */
  position?: [number, number];
  /** Saint Paul publishes only a district number (see stpaul-districts.json, loaded client-side). */
  stpaulDistrict?: number;
}

export interface CrimeResponse {
  t: number;
  incidents: CrimeIncident[];
}

const MPLS_URL = "https://services.arcgis.com/afSMGVsC7QlRK1kZ/arcgis/rest/services/Police_Incidents_Last_7_Days/FeatureServer/0/query"
  + "?where=1%3D1&outFields=OBJECTID,caseNumber,offense,description,reportedDateTime,centerLat,centerLong,neighborhood,publicaddress"
  + "&orderByFields=reportedDateTime+DESC&resultRecordCount=500&f=json";

/** Esri's query API rejects a bare epoch-ms comparison against a Date field (400); it wants this literal form. */
const timestampWhere = (field: string, sinceMs: number) => {
  const stamp = new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ");
  return encodeURIComponent(`${field} >= TIMESTAMP '${stamp}'`);
};

/**
 * Officers logging their own patrol stops ("Proactive Police Visit") are not
 * crimes: nobody reported anything. Saint Paul files them in the same dataset,
 * roughly half of its rows, so they're excluded at the source (or they'd eat
 * the row limit) and again in `isCrime` for any feed.
 */
export const isCrime = (...labels: (string | undefined)[]) => !labels.some((l) => l && /proactive police visit/i.test(l));

const stPaulUrl = (sinceMs: number) =>
  "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Crime_Incident_Report_-_Dataset/FeatureServer/0/query"
    + `?where=${timestampWhere("DATE", sinceMs)}${encodeURIComponent(" AND INCIDENT_TYPE <> 'POLICE VISIT-PROACTIVE POLICE VISIT'")}&outFields=ObjectId,CASE_NUMBER,INCIDENT_TYPE,INCIDENT,DATE,NEIGHBORHOOD_NUMBER,NEIGHBORHOOD_NAME,BLOCK`
    + "&orderByFields=DATE+DESC&resultRecordCount=1000&f=json";

const duluthUrl = (sinceMs: number) =>
  "https://services.arcgis.com/DgKyOSWnVuXUe0Jp/arcgis/rest/services/Mapped_Crimes_view/FeatureServer/0/query"
    + `?where=${timestampWhere("Reported_DateTime", sinceMs)}&outFields=OBJECTID,Case_Number,Crime_Description,Reported_DateTime,Latitude,Longitude,BlockAddress`
    + "&orderByFields=Reported_DateTime+DESC&resultRecordCount=1000&f=json";

const BLOOMINGTON_URL = "https://gis.bloomingtonmn.gov/arcgis/rest/services/Police/Police_Data_PUBLIC/MapServer/3/query";
/** The city's own address-point locator; it matches street addresses but not intersections. */
const BLOOMINGTON_LOCATOR = "https://gis.bloomingtonmn.gov/arcgis/rest/services/Geocoding/COB_Composite_Pro_26/GeocodeServer";
const bloomingtonUrl = (sinceMs: number) =>
  `${BLOOMINGTON_URL}?where=${timestampWhere("dateReported", sinceMs)}&outFields=OBJECTID,CaseNumber,dateReported,IncidentAddress,ViolationCodeReference_Desc`
  + "&returnGeometry=false&orderByFields=dateReported+DESC&resultRecordCount=1000&f=json";

interface BloomingtonFeature {
  attributes: { OBJECTID?: number; CaseNumber?: string; dateReported?: number; IncidentAddress?: string; ViolationCodeReference_Desc?: string };
}

const LOGIS = "https://maps.logis.org/arcgis/rest/services";
const EAGAN_URL = "https://services1.arcgis.com/6KEQnrFDevRaxA3V/arcgis/rest/services/Crimes_39555559678e4bd0a6fadab24001d1a2/FeatureServer/0/query";

/** The same query against any of the three layers, asking for lon/lat (Eagan's native projection is Web Mercator). */
const sinceUrl = (base: string, outFields: string, dateField: string, sinceMs: number, extraWhere = "") =>
  `${base}/query?where=${timestampWhere(dateField, sinceMs)}${extraWhere ? encodeURIComponent(` AND ${extraWhere}`) : ""}`
    + `&outFields=${outFields}&outSR=4326&orderByFields=${dateField}+DESC&resultRecordCount=1000&f=json`;

const brooklynCenterUrl = (sinceMs: number) =>
  sinceUrl(`${LOGIS}/BrooklynCenter/BC_Dept_Police_CrimeMappingCASE/MapServer/0`, "CaseNumber,DateReported,Address,Description,CategoryDecription,Neighborhoods,ViolationDecription", "DateReported", sinceMs);
const mapleGroveUrl = (sinceMs: number) =>
  sinceUrl(`${LOGIS}/MapleGrove/MG_Dept_Police_CrimeMappingCASE/MapServer/0`, "CaseNumber,DateReported,Address,Description,CategoryDescription,ViolationDecription", "DateReported", sinceMs);
// Rows with no NIBRS description are administrative records, not offenses.
const eaganUrl = (sinceMs: number) =>
  `${EAGAN_URL}?where=${timestampWhere("reportdate", sinceMs)}${encodeURIComponent(" AND nibrsdesc IS NOT NULL")}`
    + "&outFields=OBJECTID,offenseid,nibrsdesc,fulladdr,AddressMask,reportdate&outSR=4326&orderByFields=reportdate+DESC&resultRecordCount=1000&f=json";

/** A LOGIS suburb's row. Brooklyn Center spells its category field "CategoryDecription". */
interface LogisFeature {
  attributes: {
    CaseNumber?: string; DateReported?: number; Address?: string; Description?: string;
    CategoryDecription?: string; CategoryDescription?: string; Neighborhoods?: string; ViolationDecription?: string;
  };
  geometry?: { x?: number; y?: number };
}
interface EaganFeature {
  attributes: { OBJECTID?: number; offenseid?: string; nibrsdesc?: string; fulladdr?: string; AddressMask?: string; reportdate?: number };
  geometry?: { x?: number; y?: number };
}

interface MplsFeature {
  attributes: {
    OBJECTID?: number; caseNumber?: string; offense?: string; description?: string; reportedDateTime?: number;
    centerLat?: number; centerLong?: number; neighborhood?: string; publicaddress?: string;
  };
}
interface StPaulFeature {
  attributes: {
    ObjectId?: number; CASE_NUMBER?: number | string; INCIDENT_TYPE?: string; INCIDENT?: string; DATE?: number;
    NEIGHBORHOOD_NUMBER?: number; NEIGHBORHOOD_NAME?: string; BLOCK?: string;
  };
}
interface DuluthFeature {
  attributes: {
    OBJECTID?: number; Case_Number?: string; Crime_Description?: string; Reported_DateTime?: number;
    Latitude?: number; Longitude?: number; BlockAddress?: string;
  };
}

// A case number alone isn't a unique id: one case can carry several offense
// rows (one per charge), so every id below also carries the row's own
// OBJECTID -- otherwise two different offenses on the same case would
// collide and hovering one could show the other's details.

export function mplsIncidents(features: MplsFeature[]): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a } of features) {
    if (a.OBJECTID == null || !a.caseNumber || a.reportedDateTime == null || a.centerLat == null || a.centerLong == null) continue;
    if (!isCrime(a.description, a.offense)) continue;
    out.push({
      id: `mpls-${a.caseNumber}-${a.OBJECTID}`,
      city: "Minneapolis",
      category: a.description || a.offense || "Incident",
      reportedAt: Math.floor(a.reportedDateTime / 1000),
      neighborhood: a.neighborhood || undefined,
      block: a.publicaddress || undefined,
      position: [a.centerLong, a.centerLat],
    });
  }
  return out;
}

/**
 * Saint Paul's masked block ("10XX 4TH ST E", "XX EXCHANGE ST E") as a street
 * address a geocoder can place: the middle of that hundred-block ("1050 4TH ST E").
 */
export function stPaulStreet(block: string): string {
  const m = /^(\d*)X+\s+(.*)$/i.exec(block.trim());
  return m ? `${Number(m[1] || 0) * 100 + 50} ${m[2]}` : block.trim();
}

/**
 * Saint Paul publishes a district number and a masked block, not a point.
 * With `located` (block -> geocoded point) an incident draws on its own
 * street; one that couldn't be placed keeps only its district, and the
 * client scatters it inside that (see src/crime/crime.ts).
 */
export function stPaulIncidents(features: StPaulFeature[], located: ReadonlyMap<string, LonLat> = new Map()): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a } of features) {
    if (a.ObjectId == null || !a.CASE_NUMBER || a.DATE == null || a.NEIGHBORHOOD_NUMBER == null) continue;
    if (!isCrime(a.INCIDENT_TYPE, a.INCIDENT)) continue;
    out.push({
      id: `stp-${a.CASE_NUMBER}-${a.ObjectId}`,
      city: "Saint Paul",
      category: a.INCIDENT_TYPE || a.INCIDENT || "Incident",
      reportedAt: Math.floor(a.DATE / 1000),
      // "17 - Capitol River" -> "Capitol River", to match Minneapolis's plain neighborhood names.
      neighborhood: a.NEIGHBORHOOD_NAME?.replace(/^\d+\s*-\s*/, "") || undefined,
      block: a.BLOCK || undefined,
      position: a.BLOCK ? located.get(a.BLOCK) : undefined,
      stpaulDistrict: a.NEIGHBORHOOD_NUMBER,
    });
  }
  return out;
}

export function duluthIncidents(features: DuluthFeature[]): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a } of features) {
    if (a.OBJECTID == null || !a.Case_Number || a.Reported_DateTime == null || a.Latitude == null || a.Longitude == null) continue;
    if (!isCrime(a.Crime_Description)) continue;
    out.push({
      id: `duluth-${a.Case_Number}-${a.OBJECTID}`,
      city: "Duluth",
      category: a.Crime_Description || "Incident",
      reportedAt: Math.floor(a.Reported_DateTime / 1000),
      block: a.BlockAddress || undefined,
      position: [a.Longitude, a.Latitude],
    });
  }
  return out;
}

/**
 * Brooklyn Center's and Maple Grove's rows, one per offense. Brooklyn Center
 * publishes a block-masked address ("64XX JAMES CIR N") and block point;
 * Maple Grove's addresses and points are exact, so it passes `maskExact`.
 */
export function logisIncidents(city: "Brooklyn Center" | "Maple Grove", prefix: string, features: LogisFeature[], maskExact = false): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  features.forEach(({ attributes: a, geometry: g }, i) => {
    if (!a.CaseNumber || a.DateReported == null || g?.x == null || g?.y == null) return;
    const category = a.CategoryDecription || a.CategoryDescription || a.Description || a.ViolationDecription || "Incident";
    if (!isCrime(category, a.Description)) return;
    out.push({
      // One case can carry several offense rows; the row index keeps their ids apart.
      id: `${prefix}-${a.CaseNumber}-${a.DateReported}-${i}`,
      city,
      category,
      reportedAt: Math.floor(a.DateReported / 1000),
      neighborhood: a.Neighborhoods || undefined,
      block: maskExact ? toBlock(a.Address) : a.Address || undefined,
      position: maskExact ? snapToBlock(g.x, g.y) : [g.x, g.y],
    });
  });
  return out;
}

/** Roughly a city block: 0.001 degrees is about 110 m north-south and 80 m east-west here. */
const BLOCK_DEG = 0.001;

/** "3035 POPPLER LN" -> "3000 BLK POPPLER LN"; an intersection or an already-masked block passes through. */
export function toBlock(addr: string | undefined, isIntersection = false): string | undefined {
  const a = addr?.trim();
  if (!a || isIntersection) return a || undefined;
  const m = /^(\d+)\s+(.*)$/.exec(a);
  return m ? `${Math.floor(Number(m[1]) / 100) * 100} BLK ${m[2]}` : a;
}

/** The middle of the ~block-sized cell holding this point, so it can't be traced to one door. */
export const snapToBlock = (x: number, y: number): [number, number] =>
  [(Math.floor(x / BLOCK_DEG) + 0.5) * BLOCK_DEG, (Math.floor(y / BLOCK_DEG) + 0.5) * BLOCK_DEG];

/**
 * Eagan publishes the exact address and point of each offense, which most
 * other sources don't. To match them it shows only the hundred-block, with
 * the point snapped to a block-sized cell.
 */
export function eaganIncidents(features: EaganFeature[]): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a, geometry: g } of features) {
    if (a.OBJECTID == null || !a.offenseid || a.reportdate == null || !a.nibrsdesc || g?.x == null || g?.y == null) continue;
    if (!isCrime(a.nibrsdesc)) continue;
    out.push({
      id: `eagan-${a.offenseid}-${a.OBJECTID}`,
      city: "Eagan",
      category: a.nibrsdesc,
      reportedAt: Math.floor(a.reportdate / 1000),
      block: toBlock(a.fulladdr, a.AddressMask === "Intersection"),
      position: snapToBlock(g.x, g.y),
    });
  }
  return out;
}

/** Offenses are charged by statute ("609.52.2(a)(1) Theft..."); everything else Bloomington files (accidents, warrant arrests, lost property, welfare checks) isn't a crime report. */
const STATUTE = /^\d{2,3}[A-Z]?\.\d/;
const isIntersection = (a: string) => / [/&] /.test(a) || /^ramp /i.test(a);

/**
 * Bloomington's incident layer has an address and no point, so each address
 * is looked up in `located` (see onRequestGet). Exact addresses are reduced
 * to the block, like Eagan's. Intersections and misses are dropped.
 */
export function bloomingtonIncidents(features: BloomingtonFeature[], located: ReadonlyMap<string, LonLat>): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a } of features) {
    if (a.OBJECTID == null || !a.CaseNumber || a.dateReported == null || !a.IncidentAddress) continue;
    const desc = a.ViolationCodeReference_Desc ?? "";
    if (!STATUTE.test(desc)) continue;
    const category = desc.replace(/^\S+\s+/, "").trim();
    if (!isCrime(category)) continue;
    const at = located.get(a.IncidentAddress);
    if (!at) continue;
    out.push({
      id: `blm-${a.CaseNumber}-${a.OBJECTID}`,
      city: "Bloomington",
      category: category || "Incident",
      reportedAt: Math.floor(a.dateReported / 1000),
      block: toBlock(a.IncidentAddress, isIntersection(a.IncidentAddress)),
      position: snapToBlock(at[0], at[1]),
    });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    cf: { cacheTtl: TTL_S, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const onRequestGet = async (): Promise<Response> => {
  const now = Date.now();
  const since = (city: City) => now - LOOKBACK_DAYS[city] * 86_400_000;
  const feed = <T>(url: string) => fetchJson(url) as Promise<{ features?: T[] }>;
  const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].map((street) => ({ id: street, street }));

  const feeds: [City, Promise<CrimeIncident[]>][] = [
    ["Minneapolis", feed<MplsFeature>(MPLS_URL).then((d) => mplsIncidents(d.features ?? []))],
    ["Saint Paul", feed<StPaulFeature>(stPaulUrl(since("Saint Paul"))).then(async (d) => {
      const features = d.features ?? [];
      // A failed or partial geocode just leaves incidents on their district.
      const located = await censusBatch(unique(features.map((f) => f.attributes.BLOCK)).map((a) => ({ id: a.id, street: stPaulStreet(a.street) })), "Saint Paul", "MN").catch(() => new Map<string, LonLat>());
      return stPaulIncidents(features, located);
    })],
    ["Duluth", feed<DuluthFeature>(duluthUrl(since("Duluth"))).then((d) => duluthIncidents(d.features ?? []))],
    ["Brooklyn Center", feed<LogisFeature>(brooklynCenterUrl(since("Brooklyn Center"))).then((d) => logisIncidents("Brooklyn Center", "bc", d.features ?? []))],
    ["Maple Grove", feed<LogisFeature>(mapleGroveUrl(since("Maple Grove"))).then((d) => logisIncidents("Maple Grove", "mg", d.features ?? [], true))],
    ["Eagan", feed<EaganFeature>(eaganUrl(since("Eagan"))).then((d) => eaganIncidents(d.features ?? []))],
    ["Bloomington", feed<BloomingtonFeature>(bloomingtonUrl(since("Bloomington"))).then(async (d) => {
      const features = (d.features ?? []).filter((f) => STATUTE.test(f.attributes.ViolationCodeReference_Desc ?? ""));
      const addresses = unique(features.map((f) => f.attributes.IncidentAddress)).filter((a) => !isIntersection(a.street));
      return bloomingtonIncidents(features, await esriBatch(BLOOMINGTON_LOCATOR, addresses));
    })],
  ];
  const results = await Promise.allSettled(feeds.map(([, p]) => p));

  const incidents: CrimeIncident[] = [];
  const failed: { city: City; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") incidents.push(...r.value);
    else failed.push({ city: feeds[i][0], error: String(r.reason) });
  });

  if (failed.length === feeds.length) {
    return json({ error: "Every city's crime feed is unreachable." }, 502);
  }
  // A city that failed isn't missing for the next half hour: retry soon.
  return json({ t: Math.floor(now / 1000), incidents, ...(failed.length && { failed }) }, 200, `public, max-age=${failed.length ? RETRY_TTL_S : TTL_S}`);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
