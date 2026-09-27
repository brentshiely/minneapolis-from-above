/**
 * Cloudflare Pages Function: GET /api/water, and /api/water?lid=STPM5
 *
 * River and lake gauges around the metro from the National Weather
 * Service's water prediction service; with `lid`, one gauge's flood stages,
 * last-day change and forecast crest.
 */
import { parseDetail, parseGauges } from "../../src/water/gauges.ts";

const NWPS = "https://api.water.noaa.gov/nwps/v1";
const LIST = `${NWPS}/gauges?bbox.xmin=-94.2&bbox.ymin=44.5&bbox.xmax=-92.5&bbox.ymax=45.4&srid=EPSG_4326`;
/** Gauges report every 15 minutes to an hour. */
const LIST_TTL_S = 600;
const DETAIL_TTL_S = 900;

// NWS JSON goes straight into the typed parsers, which check what they use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = async (url: string, ttl: number): Promise<any> => {
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    cf: { cacheTtl: ttl, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`The water service returned ${res.status}.`);
  return res.json();
};

/**
 * The last good gauge list. NWS has brief outages; serving readings up to
 * an hour old beats showing nothing.
 */
const STALE_OK_S = 3600;
let lastList: { at: number; body: unknown } | undefined;

/** For tests. */
export function resetWaterCache() { lastList = undefined; }

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const lid = new URL(request.url).searchParams.get("lid");
  try {
    if (lid !== null) {
      if (!/^[A-Z0-9]{5}$/.test(lid)) return json({ error: "Pass a 5-character NWS gauge id, like STPM5." }, 400);
      const [gauge, flow] = await Promise.all([get(`${NWPS}/gauges/${lid}`, DETAIL_TTL_S), get(`${NWPS}/gauges/${lid}/stageflow`, DETAIL_TTL_S)]);
      return json(parseDetail(gauge, flow), 200, `public, max-age=${DETAIL_TTL_S}`);
    }
    const body = { t: Math.floor(Date.now() / 1000), gauges: parseGauges(await get(LIST, LIST_TTL_S)) };
    lastList = { at: Date.now() / 1000, body };
    return json(body, 200, `public, max-age=${LIST_TTL_S}`);
  } catch (err) {
    if (lid === null && lastList && Date.now() / 1000 - lastList.at < STALE_OK_S) return json(lastList.body, 200, "no-store");
    const why = err instanceof Error ? err.message : "The water service is unreachable.";
    // The gauge list is optional scenery: during an outage say so plainly
    // (no gauges, retry soon) instead of an error in every visitor's console.
    if (lid === null) return json({ t: Math.floor(Date.now() / 1000), gauges: [], unavailable: why }, 200, "no-store");
    return json({ error: why }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
