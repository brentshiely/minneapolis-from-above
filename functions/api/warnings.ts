/**
 * Cloudflare Pages Function: GET /api/warnings
 *
 * Active NWS watches, warnings and advisories that touch the metro: the
 * National Weather Service's alerts feed for Minnesota, kept to the ones
 * whose area actually overlaps the map. Convective warnings (tornado,
 * severe thunderstorm, flash flood) carry their own storm-tracked
 * polygon already; everything else (winter storms, advisories, heat,
 * wind) is scoped to a public forecast zone instead, so those are
 * resolved to the zone's own boundary — fetched once and cached for a
 * day, since zone shapes never change.
 */

const ALERTS_URL = "https://api.weather.gov/alerts/active?area=MN";
/** Alerts can be issued or upgraded within minutes; don't sit on stale ones too long. */
const ALERTS_TTL_S = 120;
/** Zone boundaries are static; no need to ask again for a day. */
const ZONE_TTL_S = 24 * 60 * 60;
const UA = "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)";

/** The seven core counties plus an outer ring, matching the map's own bounds. */
const METRO_ZONE_IDS = new Set([
  "MNZ060", "MNZ062", "MNZ070", "MNZ061", "MNZ063", "MNZ069", "MNZ068", // Hennepin, Ramsey, Dakota, Anoka, Washington, Scott, Carver
  "MNZ059", "MNZ051", "MNZ052", "MNZ053", // Wright, Sherburne, Isanti, Chisago
  "MNZ049", // Stearns (St. Cloud)
  "MNZ087", // Olmsted (Rochester)
  "MNZ011", "MNZ019", "MNZ037", // North, Central and Carlton/South St. Louis (Duluth)
]);
const METRO_BBOX = { minLon: -94.4, minLat: 43.8, maxLon: -91.8, maxLat: 47.0 };

export type Geometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export interface Warning {
  id: string;
  event: string;
  severity: string;
  headline: string;
  /** POSIX seconds. */
  expires: number;
  geometry: Geometry;
}

export interface WarningsResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  w: Warning[];
}

interface NwsAlertFeature {
  id?: string;
  geometry?: Geometry | null;
  properties: {
    event?: string;
    severity?: string;
    headline?: string;
    expires?: string;
    affectedZones?: string[];
  };
}

function bbox(g: Geometry): { minLon: number; minLat: number; maxLon: number; maxLat: number } {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [lon, lat] = c as [number, number];
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    } else for (const x of c as unknown[]) walk(x);
  };
  walk(g.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

function overlapsMetro(g: Geometry): boolean {
  const b = bbox(g);
  return b.minLon <= METRO_BBOX.maxLon && b.maxLon >= METRO_BBOX.minLon
    && b.minLat <= METRO_BBOX.maxLat && b.maxLat >= METRO_BBOX.minLat;
}

async function zoneGeometry(zoneId: string): Promise<Geometry | undefined> {
  try {
    const res = await fetch(`https://api.weather.gov/zones/forecast/${zoneId}`, {
      headers: { "user-agent": UA },
      cf: { cacheTtl: ZONE_TTL_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return undefined;
    const body = await res.json() as { geometry?: Geometry | null };
    return body.geometry ?? undefined;
  } catch {
    return undefined;
  }
}

export async function toResponse(features: NwsAlertFeature[]): Promise<WarningsResponse> {
  const w: Warning[] = [];
  const zoneCache = new Map<string, Promise<Geometry | undefined>>();
  for (const f of features) {
    const p = f.properties;
    if (!p.event) continue;
    const expires = p.expires ? Math.floor(Date.parse(p.expires) / 1000) : 0;
    const headline = p.headline ?? p.event;
    const severity = p.severity ?? "Unknown";
    if (f.geometry) {
      if (!overlapsMetro(f.geometry)) continue;
      w.push({ id: f.id ?? `${p.event}-${expires}`, event: p.event, severity, headline, expires, geometry: f.geometry });
      continue;
    }
    const zoneIds = (p.affectedZones ?? []).map((u) => u.split("/").pop() ?? "").filter((id) => METRO_ZONE_IDS.has(id));
    for (const zid of zoneIds) {
      if (!zoneCache.has(zid)) zoneCache.set(zid, zoneGeometry(zid));
      const geometry = await zoneCache.get(zid)!;
      if (geometry) w.push({ id: `${f.id ?? p.event}-${zid}`, event: p.event, severity, headline, expires, geometry });
    }
  }
  return { t: Math.floor(Date.now() / 1000), w };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(ALERTS_URL, {
      headers: { "user-agent": UA },
      cf: { cacheTtl: ALERTS_TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "The National Weather Service's alerts feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `NWS alerts returned ${upstream.status}.` }, 502);

  try {
    const body = await upstream.json() as { features?: NwsAlertFeature[] };
    const response = await toResponse(body.features ?? []);
    return json(response, 200, `public, max-age=${ALERTS_TTL_S}`);
  } catch {
    return json({ error: "NWS alerts couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
