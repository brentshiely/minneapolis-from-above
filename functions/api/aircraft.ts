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

// --- OpenSky -----------------------------------------------------------------

/** The map's bounds: about 1.3 square degrees, one OpenSky credit per request. */
const BOX = { lamin: 44.55, lomin: -94.15, lamax: 45.35, lomax: -92.55 };
const OPENSKY_STATES = `https://opensky-network.org/api/states/all?lamin=${BOX.lamin}&lomin=${BOX.lomin}&lamax=${BOX.lamax}&lomax=${BOX.lomax}`;
const OPENSKY_TOKEN = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
/** A free account allows ~4,000 requests a day: at most one every 30 s. */
const OPENSKY_TTL_S = 30;

type OpenSkyState = [
  string, string | null, string, number | null, number, number | null, number | null, number | null,
  boolean, number | null, number | null, number | null, unknown, number | null, ...unknown[],
];

/** OpenSky reports meters and m/s; the map speaks feet and knots like pilots do. */
export function fromOpenSky(body: { time: number; states: OpenSkyState[] | null }): AircraftResponse {
  const a: AircraftRow[] = [];
  for (const s of body.states ?? []) {
    const [hex, callsign, , timePos, , lon, lat, baroM, onGround, velocity, track, vRate, , geoM] = s;
    if (typeof lat !== "number" || typeof lon !== "number" || !inArea(lat, lon)) continue;
    const age = timePos ? Math.max(0, body.time - timePos) : 0;
    if (age > 60) continue;
    const altM = baroM ?? geoM;
    a.push([
      hex, (callsign ?? "").trim(), r5(lat), r5(lon),
      onGround ? 0 : typeof altM === "number" ? Math.max(0, Math.round(altM * 3.28084)) : null,
      typeof velocity === "number" ? Math.round(velocity * 19.4384) / 10 : null,
      typeof track === "number" ? Math.round(track * 10) / 10 : null,
      "", "", age,
      typeof vRate === "number" ? Math.round(vRate * 196.85) : null,
    ]);
  }
  return { t: body.time, a };
}

let token: { value: string; expires: number } | undefined;

async function openSkyToken(id: string, secret: string): Promise<string> {
  const now = Date.now() / 1000;
  if (token && token.expires - 60 > now) return token.value;
  const res = await fetch(OPENSKY_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  if (!res.ok) throw new Error(`OpenSky sign-in returned ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expires: now + body.expires_in };
  return token.value;
}

// --- serving ------------------------------------------------------------------

export interface AircraftEnv {
  OPENSKY_CLIENT_ID?: string;
  OPENSKY_CLIENT_SECRET?: string;
}

interface Source { name: string; ttl: number; fetch(): Promise<AircraftResponse> }

function sources(env: AircraftEnv): Source[] {
  const ua = { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" };
  const list: Source[] = [];
  if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
    const { OPENSKY_CLIENT_ID: id, OPENSKY_CLIENT_SECRET: secret } = env;
    list.push({
      name: "OpenSky", ttl: OPENSKY_TTL_S,
      async fetch() {
        const res = await fetch(OPENSKY_STATES, { headers: { ...ua, authorization: `Bearer ${await openSkyToken(id, secret)}` } });
        if (!res.ok) throw new Error(`OpenSky returned ${res.status}`);
        return fromOpenSky(await res.json());
      },
    });
  }
  for (const url of AIRCRAFT_SOURCES) {
    list.push({
      name: new URL(url).host, ttl: EDGE_TTL_S,
      async fetch() {
        const res = await fetch(url, { headers: ua, cf: { cacheTtl: EDGE_TTL_S, cacheEverything: true } } as RequestInit);
        if (!res.ok) throw new Error(`The aircraft feed returned ${res.status}.`);
        return toAircraftResponse(await res.json());
      },
    });
  }
  return list;
}

/**
 * The last good snapshot, kept in memory: reused while fresh, and served
 * for up to STALE_OK_S when every source is busy, rather than failing.
 */
const STALE_OK_S = 60;
let last: { at: number; ttl: number; body: AircraftResponse } | undefined;

/** For tests. */
export function resetAircraftCache() { last = undefined; token = undefined; }

/** Cloudflare's per-location cache, shared by every instance there (absent in Node). */
const CACHE_KEY = "https://minneapolis-from-above.internal/aircraft";
const edgeCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

export const onRequestGet = async ({ env = {} }: { env?: AircraftEnv } = {}): Promise<Response> => {
  const now = Date.now() / 1000;
  if (last && now - last.at < last.ttl) return json(last.body, 200, `public, max-age=${Math.ceil(last.ttl - (now - last.at))}`);
  const cached = await edgeCache()?.match(CACHE_KEY);
  if (cached) return cached;

  let problem = "The aircraft feed is unreachable.";
  for (const src of sources(env)) {
    try {
      const body = await src.fetch();
      last = { at: now, ttl: src.ttl, body };
      const res = json(body, 200, `public, max-age=${src.ttl}`);
      await edgeCache()?.put(CACHE_KEY, res.clone());
      return res;
    } catch (err) {
      problem = err instanceof Error ? err.message : problem;
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
