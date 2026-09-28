/**
 * Cloudflare Pages Function: GET /api/incidents
 *
 * MnDOT's live freeway incident feed (crashes, stalls, hazards, road
 * work), the same IRIS export host as /api/traffic, trimmed to the
 * metro plus St. Cloud, Rochester and Duluth, and to what's still active.
 */
import { parseStamp } from "../../src/traffic/traffic.ts";
import { gunzipText } from "./traffic.ts";

const URL = "https://data.dot.state.mn.us/iris_xml/incident.xml.gz";
const TTL_S = 30;
/** The metro plus St. Cloud, Rochester and Duluth, with margin. */
const METRO_BBOX = { minLon: -94.4, minLat: 43.8, maxLon: -91.8, maxLat: 47.0 };

export interface Incident {
  id: string;
  /** MnDOT's own event type, e.g. "INCIDENT_CRASH". */
  type: string;
  /** A specific note MnDOT gave, e.g. "Vehicle Fire", when it has one. */
  detail?: string;
  road: string;
  dir: string;
  location?: string;
  position: [number, number];
  /** POSIX seconds it was first reported. */
  at: number;
}

export interface IncidentsResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  incidents: Incident[];
}

export function parseIncidents(xml: string): IncidentsResponse {
  const t = Math.floor(Date.now() / 1000);
  const incidents: Incident[] = [];
  for (const m of xml.matchAll(/<incident ([^>]*)\/>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)='([^']*)'/g)].map((x) => [x[1], x[2]]));
    if (a.cleared === "true" || !a.name || !a.event_type || !a.road || !a.dir || !a.lon || !a.lat) continue;
    const lon = Number(a.lon), lat = Number(a.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < METRO_BBOX.minLon || lon > METRO_BBOX.maxLon || lat < METRO_BBOX.minLat || lat > METRO_BBOX.maxLat) continue;
    incidents.push({
      id: a.name, type: a.event_type, detail: a.detail || undefined, road: a.road, dir: a.dir,
      location: a.location || undefined, position: [lon, lat], at: a.event_date ? parseStamp(a.event_date) : t,
    });
  }
  return { t, incidents };
}

export const onRequestGet = async (): Promise<Response> => {
  try {
    const res = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return json({ error: `MnDOT's incident feed returned ${res.status}.` }, 502);
    return json(parseIncidents(await gunzipText(await res.arrayBuffer())), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "MnDOT's incident feed is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
