/**
 * Cloudflare Pages Function: GET /api/aurora
 *
 * NOAA SWPC's planetary K-index forecast (observed history plus a ~3-day
 * predicted run), trimmed to what a "tonight" caption needs. Already
 * answers with an open CORS header, but proxied for the same edge-cache
 * and resilience reasons every other feed here is.
 */
const FEED_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const TTL_S = 600;
const UA = "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)";

/** [POSIX seconds, Kp, is this a prediction rather than an observation]. */
export type KpRow = [number, number, boolean];

export interface AuroraResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  kp: KpRow[];
}

/** Keep the last day of observations and everything predicted ahead. */
const KEEP_ROWS = 24;

interface NoaaKpRow {
  time_tag?: string;
  kp?: number;
  observed?: string;
}

export function toResponse(rows: NoaaKpRow[]): AuroraResponse {
  const kp: KpRow[] = [];
  for (const r of rows) {
    const time = r.time_tag ? Date.parse(`${r.time_tag}Z`) : NaN;
    if (!Number.isFinite(time) || typeof r.kp !== "number") continue;
    kp.push([Math.floor(time / 1000), r.kp, r.observed === "predicted"]);
  }
  return { t: Math.floor(Date.now() / 1000), kp: kp.slice(-KEEP_ROWS) };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(FEED_URL, {
      headers: { "user-agent": UA },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "NOAA's space weather feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `NOAA's feed returned ${upstream.status}.` }, 502);

  try {
    const rows = await upstream.json() as NoaaKpRow[];
    const body = toResponse(Array.isArray(rows) ? rows : []);
    return json(body, 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "NOAA's feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
