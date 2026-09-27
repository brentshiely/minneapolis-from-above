/**
 * Cloudflare Pages Function: GET /api/wildlife
 *
 * Recent, identification-verified iNaturalist observations in the
 * metro: free, no key, already CORS-open, proxied for the same
 * edge-cache and resilience reasons every other feed here is. A photo
 * is only included when its own license permits reuse (iNaturalist
 * marks each photo's license separately from the observation itself;
 * plenty are "all rights reserved" by default).
 */
const TTL_S = 900;
const METRO_BBOX = { swlat: 44.55, swlng: -94.15, nelat: 45.35, nelng: -92.55 };
/** Sightings fade out over this many days; no point asking further back. */
const LOOKBACK_DAYS = 4;

export interface Sighting {
  id: number;
  species: string;
  /** POSIX seconds (midday UTC on the day it was observed; iNaturalist gives a date, not a time). */
  observedAt: number;
  position: [number, number];
  photo?: { url: string; attribution: string };
}

export interface WildlifeResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  sightings: Sighting[];
}

interface INatPhoto { url?: string; license_code?: string | null; attribution?: string }
interface INatResult {
  id?: number;
  observed_on?: string;
  taxon?: { preferred_common_name?: string; name?: string };
  geojson?: { coordinates?: [number, number] };
  photos?: INatPhoto[];
}

export function toResponse(results: INatResult[]): WildlifeResponse {
  const sightings: Sighting[] = [];
  for (const r of results) {
    const coords = r.geojson?.coordinates;
    if (!r.id || !r.observed_on || !coords) continue;
    const observedAt = Math.floor(Date.parse(`${r.observed_on}T12:00:00Z`) / 1000);
    if (!Number.isFinite(observedAt)) continue;
    const species = r.taxon?.preferred_common_name ?? r.taxon?.name ?? "Unidentified";
    const usable = r.photos?.find((p) => p.license_code && p.url);
    const photo = usable ? { url: usable.url!.replace("square.jpg", "medium.jpg"), attribution: usable.attribution ?? "iNaturalist" } : undefined;
    sightings.push({ id: r.id, species, observedAt, position: coords, photo });
  }
  return { t: Math.floor(Date.now() / 1000), sightings };
}

export const onRequestGet = async (): Promise<Response> => {
  const d1 = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    swlat: String(METRO_BBOX.swlat), swlng: String(METRO_BBOX.swlng), nelat: String(METRO_BBOX.nelat), nelng: String(METRO_BBOX.nelng),
    d1, order_by: "observed_on", order: "desc", photos: "true", quality_grade: "research", per_page: "60",
  });
  let upstream: Response;
  try {
    upstream = await fetch(`https://api.inaturalist.org/v1/observations?${q}`, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "iNaturalist's feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `iNaturalist's feed returned ${upstream.status}.` }, 502);

  try {
    const body = await upstream.json() as { results?: INatResult[] };
    return json(toResponse(body.results ?? []), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "iNaturalist's feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
