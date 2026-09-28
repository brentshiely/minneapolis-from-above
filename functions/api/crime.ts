/**
 * Cloudflare Pages Function: GET /api/crime
 *
 * Recent reported crime incidents from Minneapolis's and Saint Paul's own
 * open-data services (both Esri FeatureServers, free, no key, CORS-open,
 * public domain). Researched (Sept 2026): no inner-ring suburb publishes
 * an equivalent open feed -- several use LexisNexis Community Crime Map
 * or CrimeReports.com, both display-only with no public API and terms
 * that prohibit redistribution, matching the same "not authorized for
 * reuse" problem that ruled out 511mn.org's plow data and Blitzortung's
 * lightning feed. Scoped to the two cities that do have a real feed.
 *
 * Both cities already truncate location to a block or a police district
 * before publishing -- neither exposes exact addresses.
 */
const TTL_S = 1800;
/** Fades out client-side over roughly this long; no point asking further back. */
const LOOKBACK_DAYS = 3;

export type City = "Minneapolis" | "Saint Paul";

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
  + "?where=1%3D1&outFields=caseNumber,offense,description,reportedDateTime,centerLat,centerLong,neighborhood,publicaddress"
  + "&orderByFields=reportedDateTime+DESC&resultRecordCount=500&f=json";

/** Esri's query API rejects a bare epoch-ms comparison against a Date field (400); it wants this literal form. */
const stPaulUrl = (sinceMs: number) => {
  const stamp = new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ");
  const where = encodeURIComponent(`DATE >= TIMESTAMP '${stamp}'`);
  return "https://services1.arcgis.com/9meaaHE3uiba0zr8/arcgis/rest/services/Crime_Incident_Report_-_Dataset/FeatureServer/0/query"
    + `?where=${where}&outFields=CASE_NUMBER,INCIDENT_TYPE,INCIDENT,DATE,NEIGHBORHOOD_NUMBER,NEIGHBORHOOD_NAME,BLOCK`
    + "&orderByFields=DATE+DESC&resultRecordCount=1000&f=json";
};

interface MplsFeature {
  attributes: {
    caseNumber?: string; offense?: string; description?: string; reportedDateTime?: number;
    centerLat?: number; centerLong?: number; neighborhood?: string; publicaddress?: string;
  };
}
interface StPaulFeature {
  attributes: {
    CASE_NUMBER?: number | string; INCIDENT_TYPE?: string; INCIDENT?: string; DATE?: number;
    NEIGHBORHOOD_NUMBER?: number; NEIGHBORHOOD_NAME?: string; BLOCK?: string;
  };
}

export function mplsIncidents(features: MplsFeature[]): CrimeIncident[] {
  const out: CrimeIncident[] = [];
  for (const { attributes: a } of features) {
    if (!a.caseNumber || a.reportedDateTime == null || a.centerLat == null || a.centerLong == null) continue;
    out.push({
      id: `mpls-${a.caseNumber}`,
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
    if (!a.CASE_NUMBER || a.DATE == null || a.NEIGHBORHOOD_NUMBER == null) continue;
    out.push({
      id: `stp-${a.CASE_NUMBER}`,
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

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    cf: { cacheTtl: TTL_S, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export const onRequestGet = async (): Promise<Response> => {
  const since = Date.now() - LOOKBACK_DAYS * 86_400_000;
  const [mpls, stp] = await Promise.allSettled([
    fetchJson(MPLS_URL) as Promise<{ features?: MplsFeature[] }>,
    fetchJson(stPaulUrl(since)) as Promise<{ features?: StPaulFeature[] }>,
  ]);

  const incidents: CrimeIncident[] = [];
  if (mpls.status === "fulfilled") incidents.push(...mplsIncidents(mpls.value.features ?? []));
  if (stp.status === "fulfilled") incidents.push(...stPaulIncidents(stp.value.features ?? []));

  if (mpls.status === "rejected" && stp.status === "rejected") {
    return json({ error: "Both cities' crime feeds are unreachable." }, 502);
  }
  return json({ t: Math.floor(Date.now() / 1000), incidents }, 200, `public, max-age=${TTL_S}`);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
