/**
 * Cloudflare Pages Function: GET /api/beaches
 *
 * The Minneapolis Park Board's own beach water-quality layer (the same
 * ArcGIS feature service its public beaches map uses) — free, no key,
 * already CORS-open, proxied here for the same edge-cache and
 * resilience reasons every other feed in this project is. Only beaches
 * currently being tested (open or closed) are returned; outside the
 * summer season every beach reports "testing done for the season" and
 * the map has nothing useful to show.
 */
const URL = "https://services6.arcgis.com/MU31z9HAakdc3W69/arcgis/rest/services/Beach_Points_2/FeatureServer/0/query"
  + "?where=1%3D1&outFields=*&outSR=4326&f=json";
const TTL_S = 600;

export interface Beach {
  id: string;
  name: string;
  lake: string;
  status: "open" | "closed";
  reason?: string;
  position: [number, number];
}

export interface BeachesResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  beaches: Beach[];
}

interface ArcGisFeature {
  attributes?: {
    Beach?: string;
    Secondary_name?: string | null;
    Lake?: string;
    Water_Quality_Status?: string;
    Reason?: string | null;
  };
  geometry?: { x?: number; y?: number };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function toResponse(features: ArcGisFeature[]): BeachesResponse {
  const beaches: Beach[] = [];
  for (const f of features) {
    const a = f.attributes;
    const x = f.geometry?.x, y = f.geometry?.y;
    if (!a?.Beach || !a.Lake || typeof x !== "number" || typeof y !== "number") continue;
    const raw = a.Water_Quality_Status ?? "";
    const status = raw === "Open" ? "open" : raw === "Closed" ? "closed" : undefined;
    if (!status) continue;
    const name = a.Secondary_name ? `${a.Beach} (${a.Secondary_name})` : a.Beach;
    beaches.push({ id: `${slug(a.Lake)}-${slug(a.Beach)}`, name, lake: a.Lake, status, reason: a.Reason ?? undefined, position: [x, y] });
  }
  return { t: Math.floor(Date.now() / 1000), beaches };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "The Park Board's beach feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `The Park Board's beach feed returned ${upstream.status}.` }, 502);

  try {
    const body = await upstream.json() as { features?: ArcGisFeature[] };
    return json(toResponse(body.features ?? []), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "The Park Board's beach feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
