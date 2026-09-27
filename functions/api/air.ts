/**
 * Cloudflare Pages Function: GET /api/air
 *
 * Current air quality over the Twin Cities from Open-Meteo's air-quality
 * model (free, no key): the US AQI and which pollutant drives it. The model
 * updates hourly, so answers are cached for 15 minutes.
 */
import { FIELDS, parseAir, type OpenMeteoAir } from "../../src/weather/air.ts";

const URL = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=44.98&longitude=-93.27&current=${FIELDS.join(",")}`;
const CACHE_S = 900;

export const onRequestGet = async (): Promise<Response> => {
  try {
    const res = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: CACHE_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return json({ error: `The air quality service returned ${res.status}.` }, 502);
    const air = parseAir((await res.json()) as OpenMeteoAir);
    if (!air) return json({ error: "The air quality service sent no reading." }, 502);
    return json(air, 200, `public, max-age=${CACHE_S}`);
  } catch {
    return json({ error: "The air quality service is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
