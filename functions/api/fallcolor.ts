/**
 * Cloudflare Pages Function: GET /api/fallcolor
 *
 * MN DNR's Fall Color Finder, averaged across its metro-region report
 * sites: free, no key, but CORS-restricted to *.dnr.state.mn.us, so
 * proxied here rather than fetched directly from the browser. This is
 * a seasonal program (roughly September–November); reports older than
 * three weeks are treated as stale rather than shown as if current, so
 * the map doesn't stay tinted for "peak color" all winter.
 */
const URL = "https://www.dnr.state.mn.us/data/export/fall-colors/all.json";
const TTL_S = 12 * 3600;
const STALE_DAYS = 21;

export interface FallColorResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  /** Average of the metro-region sites' "leaves" score (1 no change – 6 past peak), or undefined out of season. */
  avgLeaves?: number;
  samples: number;
}

interface Site { date?: string; region?: string; leaves?: string }

export function toResponse(sites: Site[]): FallColorResponse {
  const now = Date.now();
  const values: number[] = [];
  for (const s of sites) {
    if (s.region !== "metro" || !s.date || !s.leaves) continue;
    const [m, d, y] = s.date.split("/").map(Number);
    if (!m || !d || !y) continue;
    const ageDays = (now - Date.UTC(y, m - 1, d)) / 86_400_000;
    if (ageDays < 0 || ageDays > STALE_DAYS) continue;
    const leaves = Number(s.leaves);
    if (Number.isFinite(leaves)) values.push(leaves);
  }
  const t = Math.floor(now / 1000);
  if (!values.length) return { t, samples: 0 };
  return { t, avgLeaves: values.reduce((a, b) => a + b, 0) / values.length, samples: values.length };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "MN DNR's fall color feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `MN DNR's fall color feed returned ${upstream.status}.` }, 502);

  try {
    return json(toResponse(await upstream.json() as Site[]), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "MN DNR's fall color feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
