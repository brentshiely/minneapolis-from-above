/**
 * Cloudflare Pages Function: GET /api/crime
 *
 * Recent reported crime incidents from Minneapolis's, Saint Paul's and
 * Duluth's own open-data services (all Esri FeatureServers, free, no
 * key, CORS-open). Researched (Sept 2026): no inner-ring suburb of the
 * Twin Cities publishes an equivalent open feed -- several use LexisNexis
 * Community Crime Map or CrimeReports.com, both display-only with no
 * public API and terms that prohibit redistribution, matching the same
 * "not authorized for reuse" problem that ruled out 511mn.org's plow
 * data and Blitzortung's lightning feed. Scoped to the cities that do
 * have a real feed.
 *
 * All three already truncate location to a block or a police district
 * before publishing -- none exposes an exact address. Minneapolis and
 * Saint Paul update roughly daily; Duluth's own dashboard says weekly,
 * and its freshest record is often a week old -- so Duluth uses a much
 * longer lookback and fade than the Twin Cities (see LOOKBACK_DAYS and
 * src/crime/crime.ts's FADE_DAYS).
 */
const TTL_S = 1800;
/** Fades out client-side over roughly this long; no point asking further back. Duluth updates weekly, so it gets a longer window. */
const LOOKBACK_DAYS: Record<City, number> = { Minneapolis: 3, "Saint Paul": 3, Duluth: 14 };

export type City = "Minneapolis" | "Saint Paul" | "Duluth";

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

export function stPaulIncidents(features: StPaulFeature[]): CrimeIncident[] {
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
  const [mpls, stp, duluth] = await Promise.allSettled([
    fetchJson(MPLS_URL) as Promise<{ features?: MplsFeature[] }>,
    fetchJson(stPaulUrl(now - LOOKBACK_DAYS["Saint Paul"] * 86_400_000)) as Promise<{ features?: StPaulFeature[] }>,
    fetchJson(duluthUrl(now - LOOKBACK_DAYS.Duluth * 86_400_000)) as Promise<{ features?: DuluthFeature[] }>,
  ]);

  const incidents: CrimeIncident[] = [];
  if (mpls.status === "fulfilled") incidents.push(...mplsIncidents(mpls.value.features ?? []));
  if (stp.status === "fulfilled") incidents.push(...stPaulIncidents(stp.value.features ?? []));
  if (duluth.status === "fulfilled") incidents.push(...duluthIncidents(duluth.value.features ?? []));

  if (mpls.status === "rejected" && stp.status === "rejected" && duluth.status === "rejected") {
    return json({ error: "Every city's crime feed is unreachable." }, 502);
  }
  return json({ t: Math.floor(now / 1000), incidents }, 200, `public, max-age=${TTL_S}`);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
