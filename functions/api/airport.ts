/**
 * Cloudflare Pages Function: GET /api/airport
 *
 * The FAA's own National Airspace System status feed, filtered to MSP.
 * A quiet caption only when something's actually happening (a ground
 * stop, a ground delay program, a general arrival/departure delay, or a
 * closure) — most days this is empty.
 */
const URL = "https://nasstatus.faa.gov/api/airport-status-information";
const TTL_S = 300;

export type MspStatus =
  | { kind: "ground-stop"; reason: string; until: string }
  | { kind: "ground-delay"; reason: string; avg: string; max: string }
  | { kind: "delay"; type: "Arrival" | "Departure"; reason: string; min: string; max: string; trend: string }
  | { kind: "closure"; reason: string; start: string; reopen: string };

export interface AirportResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  status: MspStatus[];
}

/** A tiny, forgiving XML-attribute-free tag reader for the FAA's simple element-per-field XML. */
function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1];
}

function forEachBlock(xml: string, outer: string, inner: string, fn: (block: string) => void) {
  const list = new RegExp(`<${outer}>([\\s\\S]*?)</${outer}>`).exec(xml)?.[1];
  if (!list) return;
  for (const m of list.matchAll(new RegExp(`<${inner}>([\\s\\S]*?)</${inner}>`, "g"))) fn(m[1]);
}

export function parseAirport(xml: string): AirportResponse {
  const status: MspStatus[] = [];
  forEachBlock(xml, "Ground_Stop_List", "Program", (b) => {
    if (tag(b, "ARPT") !== "MSP") return;
    status.push({ kind: "ground-stop", reason: tag(b, "Reason") ?? "", until: tag(b, "End_Time") ?? "" });
  });
  forEachBlock(xml, "Ground_Delay_List", "Ground_Delay", (b) => {
    if (tag(b, "ARPT") !== "MSP") return;
    status.push({ kind: "ground-delay", reason: tag(b, "Reason") ?? "", avg: tag(b, "Avg") ?? "", max: tag(b, "Max") ?? "" });
  });
  forEachBlock(xml, "Arrival_Departure_Delay_List", "Delay", (b) => {
    if (tag(b, "ARPT") !== "MSP") return;
    const type = /Type="(Arrival|Departure)"/.exec(b)?.[1] as "Arrival" | "Departure" | undefined;
    if (!type) return;
    status.push({ kind: "delay", type, reason: tag(b, "Reason") ?? "", min: tag(b, "Min") ?? "", max: tag(b, "Max") ?? "", trend: tag(b, "Trend") ?? "" });
  });
  forEachBlock(xml, "Airport_Closure_List", "Airport", (b) => {
    if (tag(b, "ARPT") !== "MSP") return;
    status.push({ kind: "closure", reason: tag(b, "Reason") ?? "", start: tag(b, "Start") ?? "", reopen: tag(b, "Reopen") ?? "" });
  });
  return { t: Math.floor(Date.now() / 1000), status };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "The FAA's status feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `The FAA's status feed returned ${upstream.status}.` }, 502);

  try {
    return json(parseAirport(await upstream.text()), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "The FAA's status feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
