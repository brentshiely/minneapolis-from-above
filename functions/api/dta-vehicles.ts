/**
 * Cloudflare Pages Function: GET /api/dta-vehicles
 *
 * Live buses from the Duluth Transit Authority's own GTFS-realtime feed:
 * free, no key, no auth, confirmed live (Sept 2026). DTA's developer page
 * grants an explicit "non-exclusive, limited and revocable right to use,
 * reproduce, and redistribute DTA Data" -- a real reuse grant, not just an
 * accidentally-open endpoint.
 *
 * Ids, trip ids and route ids are all prefixed "dta-" so they can never
 * collide with Metro Transit's own, letting both feeds merge into one
 * Fleet and one baked route file (see scripts/build-dta-gtfs.mjs).
 */
import { decodeVehicleFeed } from "../_lib/gtfsrt.ts";
import type { VehicleRow, VehiclesResponse } from "./vehicles.ts";

export const FEED_URL = "https://duluthtransit.com/gtfsrt/Vehicle/VehiclePositions.pb";

/** DTA refreshes positions about as often as Metro Transit; don't ask more than that. */
const EDGE_TTL_S = 10;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Duluth-Superior service area, generous enough that a GPS glitch elsewhere gets dropped, not mislocated. */
export function inServiceArea(lat: number, lon: number): boolean {
  return lat > 46.4 && lat < 47.1 && lon > -92.4 && lon < -91.7;
}

export function toResponse(bytes: Uint8Array): VehiclesResponse {
  const feed = decodeVehicleFeed(bytes);
  const t = feed.timestamp ?? Math.floor(Date.now() / 1000);
  const v: VehicleRow[] = [];
  for (const x of feed.vehicles) {
    if (!inServiceArea(x.lat, x.lon)) continue;
    v.push([
      `dta-${x.id}`, `dta-${x.tripId}`, `dta-${x.routeId}`, round5(x.lat), round5(x.lon),
      x.timestamp ?? t,
      x.bearing === undefined ? null : Math.round(x.bearing),
    ]);
  }
  return { t, v };
}

export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(FEED_URL, {
      cf: { cacheTtl: EDGE_TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "Duluth Transit Authority's feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `Duluth Transit Authority's feed returned ${upstream.status}.` }, 502);

  try {
    const body = toResponse(new Uint8Array(await upstream.arrayBuffer()));
    return json(body, 200, `public, max-age=${EDGE_TTL_S}`);
  } catch {
    return json({ error: "Duluth Transit Authority's feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
