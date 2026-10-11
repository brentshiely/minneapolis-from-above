/**
 * Cloudflare Pages Function: GET /api/drones
 *
 * Recent police drone flights from the public flight logs several Minnesota
 * departments keep for their drone-as-first-responder programs (hosted by
 * the drone maker as ArcGIS feature services): each flight's path, when it
 * flew, and the legal reason logged for it under Minnesota Statutes 626.19.
 *
 * What's kept back, on purpose:
 * - Anything under three hours old, so an operation in progress isn't shown.
 * - Case numbers, pilot names and emails, the free-text notes some
 *   departments write (they can describe a person in distress), and training
 *   or test flights.
 * - Exact positions. A drone hovers at the call, so its path pins the
 *   address. Every flight is shifted as a whole by a fixed offset of roughly
 *   60-140 meters (derived from its id, so it never moves between polls), which
 *   keeps the shape of the flight and the part of town, not the doorstep.
 */
const SERVICES = "https://services7.arcgis.com/mnhQTdIYDA7UoY2l/arcgis/rest/services";
export const DEPARTMENTS: Record<string, string> = {
  "St. Paul": "bc5608cb-2788-4280-92c2-7322bd2a213e",
  "Brooklyn Park": "5476bd24-9000-4625-8756-139e0b63a3ee",
  Minnetonka: "a5d35662-d210-4194-b2c4-7e9332fc2732",
  Duluth: "54924db8-8cd4-413b-8ab5-ee1412b6fba3",
  "St. Cloud": "fc542615-7161-478a-b623-60b82e6ea9ab",
  Rochester: "deea8289-a117-4089-b1a8-d1d646a4608b",
};
const TTL_S = 1800;
const RETRY_TTL_S = 90;
/** Fades out client-side over two days; no point asking further back. */
const LOOKBACK_S = 2 * 86_400;
/** Nothing newer than this is shown. */
export const MIN_AGE_S = 3 * 3600;
/** The service simplifies each path to within this many degrees (about 30 m): hover loops collapse to a mark. */
const SIMPLIFY_DEG = 0.0003;
const MAX_VERTICES = 160;

export interface DroneFlight {
  id: string;
  city: string;
  /** The reason logged, in plain words. */
  reason: string;
  /** POSIX seconds the flight took off. */
  takeoff: number;
  /** [lon, lat] polylines; a flight is several when the telemetry had gaps. */
  paths: [number, number][][];
}

export interface DronesResponse {
  t: number;
  flights: DroneFlight[];
  failed?: { city: string; error: string }[];
}

interface Feature {
  attributes: { flight_id?: string; takeoff?: number; flight_purpose?: string };
  geometry?: { paths?: [number, number][][] };
}

/**
 * The logged reason in plain words, or undefined for a flight that isn't a
 * response at all (training, a test, a public demonstration). Departments word
 * it differently: some log the statutory exception, St. Cloud logs the call type.
 */
export function reasonFor(purpose: string | undefined): string | undefined {
  const p = (purpose ?? "").trim();
  if (/training|public relations|\btest\b|demonstrat|cancel/i.test(p)) return undefined;
  if (/emergenc|death|bodily harm|missing|welfare|locate|rescue|medical|overdose|drown|threat assessment/i.test(p)) return "an emergency or a missing person";
  if (/crash|accident|traffic/i.test(p)) return "a traffic crash";
  if (/reasonable suspicion|criminal|suspicious|assault|burglar|theft|fight|disturbance|prowler|alarm|weapon|shots/i.test(p)) return "possible criminal activity";
  return "a police call";
}

/** FNV-1a: a stable 32-bit hash of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The shift applied to a flight, in meters east and north: 60-140 m in a direction fixed by its id. */
export function offsetFor(id: string): [number, number] {
  const h = hash(id);
  const angle = ((h % 3600) / 3600) * 2 * Math.PI;
  const m = 60 + ((h >>> 12) % 81);
  return [Math.cos(angle) * m, Math.sin(angle) * m];
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Shift every vertex by the flight's own offset, thin out a long path, and round to about 10 m. */
export function displace(id: string, paths: [number, number][][]): [number, number][][] {
  const [east, north] = offsetFor(id);
  const total = paths.reduce((n, p) => n + p.length, 0);
  const step = Math.max(1, Math.ceil(total / MAX_VERTICES));
  return paths
    .map((path) => path.filter((_, i) => i % step === 0 || i === path.length - 1))
    .filter((path) => path.length >= 2)
    .map((path) => path.map(([lon, lat]) => [
      round4(lon + east / (111_320 * Math.cos((lat * Math.PI) / 180))),
      round4(lat + north / 111_320),
    ] as [number, number]));
}

export function droneFlights(city: string, features: Feature[], nowS: number): DroneFlight[] {
  const out: DroneFlight[] = [];
  for (const { attributes: a, geometry: g } of features) {
    if (!a.flight_id || a.takeoff == null || !g?.paths?.length) continue;
    const takeoff = Math.floor(a.takeoff / 1000);
    if (nowS - takeoff < MIN_AGE_S || nowS - takeoff > LOOKBACK_S) continue;
    const reason = reasonFor(a.flight_purpose);
    if (!reason) continue;
    const paths = displace(a.flight_id, g.paths);
    if (!paths.length) continue;
    out.push({ id: `dr-${hash(a.flight_id).toString(36)}`, city, reason, takeoff, paths });
  }
  return out;
}

/** Esri's query API wants this literal form for a date comparison. */
const sinceWhere = (sinceMs: number) =>
  encodeURIComponent(`takeoff >= TIMESTAMP '${new Date(sinceMs).toISOString().slice(0, 19).replace("T", " ")}'`);

async function fetchDepartment(city: string, id: string, now: number): Promise<DroneFlight[]> {
  const url = `${SERVICES}/${id}-production/FeatureServer/0/query?where=${sinceWhere(now - LOOKBACK_S * 1000)}`
    + "&outFields=flight_id,takeoff,flight_purpose&outSR=4326&geometryPrecision=5"
    + `&maxAllowableOffset=${SIMPLIFY_DEG}&orderByFields=takeoff+DESC&resultRecordCount=300&f=json`;
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    cf: { cacheTtl: TTL_S, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`${res.status}`);
  const body = (await res.json()) as { features?: Feature[]; error?: unknown };
  if (body.error) throw new Error("service error");
  return droneFlights(city, body.features ?? [], Math.floor(now / 1000));
}

export const onRequestGet = async (): Promise<Response> => {
  const now = Date.now();
  const entries = Object.entries(DEPARTMENTS);
  const results = await Promise.allSettled(entries.map(([city, id]) => fetchDepartment(city, id, now)));
  const flights: DroneFlight[] = [];
  const failed: { city: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") flights.push(...r.value);
    else failed.push({ city: entries[i][0], error: String(r.reason) });
  });
  if (failed.length === entries.length) return json({ error: "Every department's drone log is unreachable." }, 502);
  return json({ t: Math.floor(now / 1000), flights, ...(failed.length && { failed }) }, 200, `public, max-age=${failed.length ? RETRY_TTL_S : TTL_S}`);
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
