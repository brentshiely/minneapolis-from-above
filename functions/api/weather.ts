/**
 * Cloudflare Pages Function: GET /api/weather
 *
 * The latest National Weather Service observation at MSP airport,
 * classified into what the map shows. NWS updates hourly (more often in
 * changing weather), so answers are cached for 5 minutes.
 */
import { classify } from "../../src/weather/classify.ts";

const URL = "https://api.weather.gov/stations/KMSP/observations/latest";
const CACHE_S = 300;

export const onRequestGet = async (): Promise<Response> => {
  try {
    const res = await fetch(URL, {
      headers: {
        // NWS asks every client to identify itself.
        "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)",
        accept: "application/geo+json",
      },
      cf: { cacheTtl: CACHE_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return json({ error: `The weather service returned ${res.status}.` }, 502);
    const body = (await res.json()) as { properties?: Parameters<typeof classify>[0] };
    if (!body.properties) return json({ error: "The weather service sent no observation." }, 502);
    return json(classify(body.properties), 200, `public, max-age=${CACHE_S}`);
  } catch {
    return json({ error: "The weather service is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
