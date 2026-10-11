/**
 * Cloudflare Pages Function: GET /api/geocode?q=...
 *
 * Finds a place for the map's search box. Three free, keyless sources are
 * asked at once and merged, because none is good at everything:
 *
 * - the Metropolitan Council's metro-wide locator: exact street addresses,
 *   plus named places (Mall of America, Lake Harriet, U.S. Bank Stadium);
 * - the Council's streets locator: intersections ("Lake St and Hennepin Ave
 *   Minneapolis"), which only match with a city;
 * - Photon, an OpenStreetMap geocoder: bare street names, landmarks and
 *   neighborhoods, and the places outside the metro (Duluth).
 *
 * Results are cached a day per query at the edge (see _lib/edgecache.ts), so
 * a place is looked up once however many people search for it.
 */
const METC = "https://arcgis.metc.state.mn.us/arcgis/rest/services";
const PHOTON = "https://photon.komoot.io/api/";
/** The metro, St. Cloud and Duluth: lon min, lat min, lon max, lat max. */
const BBOX = "-95.0,44.2,-91.8,47.0";
const TTL_S = 86_400;
/** Partial answers (a source was down) are retried soon. */
const RETRY_TTL_S = 60;
const SOURCE_TIMEOUT_MS = 4000;
const MAX_RESULTS = 6;

export type PlaceKind = "address" | "intersection" | "place" | "street" | "area";

export interface Place {
  label: string;
  detail?: string;
  lon: number;
  lat: number;
  kind: PlaceKind;
  /** A zoom that frames it sensibly: close for an address, wide for a city. */
  zoom: number;
}

export interface GeocodeResponse { results: Place[] }

const ZOOM: Record<PlaceKind, number> = { address: 17, intersection: 16.5, place: 16, street: 15, area: 13 };
/** Rank when merging: a precise match beats a vague one. */
const RANK: Record<PlaceKind, number> = { address: 0, intersection: 1, place: 2, street: 3, area: 4 };

interface EsriCandidate { address?: string; score?: number; location?: { x?: number; y?: number } }

/** "1600 98th St W, Bloomington, Minnesota, 55431" -> a label and "Bloomington, MN 55431". */
function splitAddress(full: string): { label: string; detail?: string } {
  const parts = full.split(",").map((s) => s.trim()).filter(Boolean);
  const label = parts.shift() ?? full;
  const detail = parts.join(", ").replace(/\bMinnesota\b/, "MN").replace(/, (\d{5})$/, " $1");
  return { label, ...(detail && { detail }) };
}

export function fromEsri(candidates: EsriCandidate[]): Place[] {
  const out: Place[] = [];
  for (const c of candidates) {
    const { x, y } = c.location ?? {};
    if (!c.address || x == null || y == null || (c.score ?? 0) < 80) continue;
    const { label, detail } = splitAddress(c.address);
    // A bare city name comes back as the city's center: useful, but it's an area, not an address.
    const kind: PlaceKind = /^\d/.test(label) ? "address" : / & | and /.test(label) ? "intersection" : detail || (c.score ?? 0) >= 95 ? "place" : "area";
    out.push({ label, detail, lon: x, lat: y, kind, zoom: ZOOM[kind] });
  }
  return out;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; type?: string; osm_value?: string; street?: string; housenumber?: string; city?: string; county?: string; district?: string; state?: string };
}

export function fromPhoton(features: PhotonFeature[]): Place[] {
  const out: Place[] = [];
  for (const f of features) {
    const p = f.properties, c = f.geometry?.coordinates;
    if (!p || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (p.state && p.state !== "Minnesota") continue; // the bounding box clips into Wisconsin
    const name = p.name ?? (p.housenumber && p.street ? `${p.housenumber} ${p.street}` : undefined);
    if (!name) continue;
    const kind: PlaceKind =
      p.type === "street" ? "street"
      : ["city", "town", "village", "locality", "district", "county", "state"].includes(p.type ?? "") ? "area"
      // A named business or landmark on a street is a place; only a bare "123 Main St" is an address.
      : !p.name && p.housenumber ? "address" : "place";
    const where = [kind === "place" || kind === "address" ? p.street : undefined, p.city ?? p.county].filter(Boolean).join(", ");
    out.push({ label: name, ...(where && { detail: where }), lon: c[0], lat: c[1], kind, zoom: ZOOM[kind] });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Meters between two points; flat-earth is exact enough at metro scale. */
function distM(a: Place, b: Place): number {
  const kx = 111_320 * Math.cos(((a.lat + b.lat) * Math.PI) / 360);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * 111_320);
}

/**
 * What was typed, named exactly, comes first ("Uptown", "Nicollet Mall"); then
 * the best kinds; the same place from two sources only once; at most `MAX_RESULTS`.
 */
export function merge(query: string, ...lists: Place[][]): Place[] {
  const rank = (p: Place) => (norm(p.label) === norm(query) ? -1 : RANK[p.kind]);
  const all = lists.flat().map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i);
  const kept: Place[] = [];
  for (const { p } of all) {
    // The same name within a block, or any two results within a few meters, are one place.
    // A long street is found as several pieces; one is enough to fly to.
    const near = (k: Place) => (norm(k.label) === norm(p.label) && distM(k, p) < (p.kind === "street" ? 3000 : 400)) || distM(k, p) < 15;
    if (kept.some(near)) continue;
    kept.push(p);
    if (kept.length === MAX_RESULTS) break;
  }
  return kept;
}

const get = async (url: string): Promise<unknown> => {
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

const esriUrl = (locator: string, q: string) =>
  `${METC}/${locator}/GeocodeServer/findAddressCandidates?${new URLSearchParams({ SingleLine: q, outSR: "4326", maxLocations: "4", f: "json" })}`;

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 120) return json({ error: "Type at least two characters." }, 400);

  const [addresses, streets, photon] = await Promise.allSettled([
    get(esriUrl("composite", q)) as Promise<{ candidates?: EsriCandidate[] }>,
    get(esriUrl("metro_streets", q)) as Promise<{ candidates?: EsriCandidate[] }>,
    get(`${PHOTON}?${new URLSearchParams({ q, bbox: BBOX, limit: "6", lang: "en", lat: "44.96", lon: "-93.2" })}`) as Promise<{ features?: PhotonFeature[] }>,
  ]);
  const settled = [addresses, streets, photon];
  if (settled.every((r) => r.status === "rejected")) return json({ error: "Search is unavailable right now." }, 502);

  const results = merge(
    q,
    addresses.status === "fulfilled" ? fromEsri(addresses.value.candidates ?? []) : [],
    streets.status === "fulfilled" ? fromEsri(streets.value.candidates ?? []) : [],
    photon.status === "fulfilled" ? fromPhoton(photon.value.features ?? []) : [],
  );
  const complete = settled.every((r) => r.status === "fulfilled");
  return json({ results }, 200, `public, max-age=${complete ? TTL_S : RETRY_TTL_S}`);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
