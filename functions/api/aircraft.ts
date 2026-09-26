/**
 * Cloudflare Pages Function: GET /api/aircraft
 *
 * Live aircraft over the metro from free, community-run ADS-B networks
 * (no keys), trimmed to compact rows. adsb.lol first; it rate-limits
 * Cloudflare's shared egress addresses, so adsb.fi (same format) is the
 * fallback.
 */

/** Center of the map's bounds and a radius (nautical miles) that covers them. */
const CENTER = { lat: 44.95, lon: -93.35 };
const RADIUS_NM = 45;
export const AIRCRAFT_SOURCES = [
  `https://api.adsb.lol/v2/point/${CENTER.lat}/${CENTER.lon}/${RADIUS_NM}`,
  `https://opendata.adsb.fi/api/v2/lat/${CENTER.lat}/lon/${CENTER.lon}/dist/${RADIUS_NM}`,
];

/** Planes cover ~1 km in 5 s at approach speed; refresh often. */
const EDGE_TTL_S = 4;

/**
 * One aircraft as [hex, callsign, lat, lon, altitudeFt, groundSpeedKt,
 * trackDeg, type, registration, positionAgeS, verticalRateFpm]. Altitude is
 * 0 on the ground; altitude, speed, track and vertical rate are null when
 * unknown.
 */
export type AircraftRow = [
  string, string, number, number, number | null, number | null, number | null, string, string, number, number | null,
];

export interface AircraftResponse {
  /** When adsb.lol produced the snapshot, POSIX seconds. */
  t: number;
  a: AircraftRow[];
}

interface AdsbAircraft {
  hex: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | "ground";
  gs?: number;
  track?: number;
  true_heading?: number;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  baro_rate?: number;
  geom_rate?: number;
}

/** Same generous box as the transit feed. */
function inArea(lat: number, lon: number) {
  return lat > 44.3 && lat < 45.8 && lon > -94.6 && lon < -92.2;
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** adsb.lol names the list `ac`; adsb.fi names it `aircraft`. */
export function toAircraftResponse(body: { now?: number; ac?: AdsbAircraft[]; aircraft?: AdsbAircraft[] }): AircraftResponse {
  const t = body.now ? body.now / 1000 : Date.now() / 1000;
  const a: AircraftRow[] = [];
  for (const x of body.ac ?? body.aircraft ?? []) {
    if (typeof x.lat !== "number" || typeof x.lon !== "number" || !inArea(x.lat, x.lon)) continue;
    // Positions older than a minute are too stale to animate from.
    if ((x.seen_pos ?? 0) > 60) continue;
    const alt = x.alt_baro === "ground" ? 0 : typeof x.alt_baro === "number" ? Math.max(0, x.alt_baro) : null;
    const track = x.track ?? x.true_heading;
    a.push([
      x.hex, (x.flight ?? "").trim(), r5(x.lat), r5(x.lon), alt,
      typeof x.gs === "number" ? Math.round(x.gs * 10) / 10 : null,
      typeof track === "number" ? Math.round(track * 10) / 10 : null,
      x.t ?? "", x.r ?? "", Math.round((x.seen_pos ?? 0) * 10) / 10,
      typeof (x.baro_rate ?? x.geom_rate) === "number" ? Math.round((x.baro_rate ?? x.geom_rate)!) : null,
    ]);
  }
  return { t: Math.round(t * 10) / 10, a };
}

/**
 * adsb.lol allows about one request a second. Keep the last good snapshot
 * in memory: reuse it for EDGE_TTL_S, and fall back to it for up to
 * STALE_OK_S when adsb.lol is busy, rather than failing.
 */
const STALE_OK_S = 30;
let last: { at: number; body: AircraftResponse } | undefined;

/** For tests. */
export function resetAircraftCache() { last = undefined; }

export const onRequestGet = async (): Promise<Response> => {
  const now = Date.now() / 1000;
  if (last && now - last.at < EDGE_TTL_S) return json(last.body, 200, `public, max-age=${EDGE_TTL_S}`);

  let problem = "The aircraft feed is unreachable.";
  for (const url of AIRCRAFT_SOURCES) {
    try {
      const upstream = await fetch(url, {
        headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
        cf: { cacheTtl: EDGE_TTL_S, cacheEverything: true },
      } as RequestInit);
      if (upstream.ok) {
        const body = toAircraftResponse(await upstream.json());
        last = { at: now, body };
        return json(body, 200, `public, max-age=${EDGE_TTL_S}`);
      }
      problem = `The aircraft feed returned ${upstream.status}.`;
    } catch {
      problem = "The aircraft feed is unreachable.";
    }
  }
  if (last && now - last.at < STALE_OK_S) return json(last.body, 200, "no-store");
  return json({ error: problem }, 502);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
