import { decodeVehicleFeed } from "../_lib/gtfsrt.ts";

export const FEED_URL = "https://svc.metrotransit.org/mtgtfs/vehiclepositions.pb";

/** Metro Transit refreshes positions about every 15 s; don't ask more often. */
const EDGE_TTL_S = 10;

/**
 * One vehicle as [id, tripId, routeId, lat, lon, timestamp, bearing].
 * Rows instead of objects keep the payload about a third the size.
 */
export type VehicleRow = [string, string, string, number, number, number, number | null];

export interface VehiclesResponse {
  /** Feed generation time, POSIX seconds. */
  t: number;
  v: VehicleRow[];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Generous box around the service area. The live feed sometimes reports
 * vehicles without a GPS fix at 0,0; those are dropped here.
 */
export function inServiceArea(lat: number, lon: number): boolean {
  return lat > 44.3 && lat < 45.8 && lon > -94.6 && lon < -92.2;
}

export function toResponse(bytes: Uint8Array): VehiclesResponse {
  const feed = decodeVehicleFeed(bytes);
  const t = feed.timestamp ?? Math.floor(Date.now() / 1000);
  return {
    t,
    v: feed.vehicles.filter((x) => inServiceArea(x.lat, x.lon)).map((x) => [
      x.id, x.tripId, x.routeId, round5(x.lat), round5(x.lon),
      x.timestamp ?? t,
      x.bearing === undefined ? null : Math.round(x.bearing),
    ]),
  };
}

/** Cloudflare Pages Function: GET /api/vehicles */
export const onRequestGet = async (): Promise<Response> => {
  let upstream: Response;
  try {
    upstream = await fetch(FEED_URL, {
      // Cloudflare-only: share one upstream fetch per edge location per TTL.
      cf: { cacheTtl: EDGE_TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return json({ error: "Metro Transit's feed is unreachable." }, 502);
  }
  if (!upstream.ok) return json({ error: `Metro Transit's feed returned ${upstream.status}.` }, 502);

  try {
    const body = toResponse(new Uint8Array(await upstream.arrayBuffer()));
    return json(body, 200, `public, max-age=${EDGE_TTL_S}`);
  } catch {
    return json({ error: "Metro Transit's feed couldn't be decoded." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
