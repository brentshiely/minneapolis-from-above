/**
 * Cloudflare Pages Function: GET /api/amtrak
 *
 * Where Amtrak's trains are, from Amtraker's v3 API (a community service that
 * republishes Amtrak's own train tracking). Amtrak has no public feed of its
 * own. Only the trains inside the map's reach come back, a row each:
 * position, speed, how late, and the next stop.
 */
const URL = "https://api-v3.amtraker.com/v3/trains";
const TTL_S = 60;
const RETRY_TTL_S = 30;
/** The map's box (see scripts/build-mndot.mjs) with a margin, so a train is known before it rolls into view. */
const BOX = { minLon: -95.2, maxLon: -91.0, minLat: 43.3, maxLat: 47.5 };

export interface AmtrakRow {
  /** Amtraker's id for this run of the train: "8-10" is train 8, started on the 10th. */
  id: string;
  num: string;
  route: string;
  lat: number;
  lon: number;
  /** Miles per hour, as reported. */
  mph: number;
  /** Compass heading as reported ("E", "NW"), or "". */
  heading: string;
  /** POSIX seconds of the position. */
  at: number;
  /** Minutes behind schedule at the next stop (negative: ahead), or null when unknown. */
  late: number | null;
  next: string;
  from: string;
  to: string;
}

export interface AmtrakResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  trains: AmtrakRow[];
}

interface Stop { name?: string; code?: string; schArr?: string; arr?: string }
interface RawTrain {
  routeName?: string; trainNum?: string; trainID?: string;
  lat?: number; lon?: number; velocity?: number; heading?: string;
  eventCode?: string; eventName?: string; origName?: string; destName?: string;
  lastValTS?: string; updatedAt?: string; trainState?: string;
  stations?: Stop[];
}

const minutes = (a?: string, b?: string): number | null => {
  const x = a ? Date.parse(a) : NaN, y = b ? Date.parse(b) : NaN;
  return Number.isFinite(x) && Number.isFinite(y) ? Math.round((x - y) / 60_000) : null;
};

/** Boil Amtraker's answer down to the active trains inside the map's reach. */
export function amtrakRows(body: Record<string, RawTrain[]>, nowS: number): AmtrakRow[] {
  const out: AmtrakRow[] = [];
  for (const trains of Object.values(body)) {
    for (const t of trains) {
      if (typeof t.lat !== "number" || typeof t.lon !== "number" || !t.trainID) continue;
      if (t.trainState && t.trainState !== "Active") continue;
      if (t.lon < BOX.minLon || t.lon > BOX.maxLon || t.lat < BOX.minLat || t.lat > BOX.maxLat) continue;
      const stop = t.stations?.find((s) => s.code === t.eventCode);
      const stamp = Date.parse(t.lastValTS ?? t.updatedAt ?? "");
      out.push({
        id: t.trainID,
        num: t.trainNum ?? "",
        route: t.routeName ?? "Amtrak",
        lat: Math.round(t.lat * 1e5) / 1e5,
        lon: Math.round(t.lon * 1e5) / 1e5,
        mph: Math.round(t.velocity ?? 0),
        heading: t.heading ?? "",
        at: Number.isFinite(stamp) ? Math.min(nowS, Math.floor(stamp / 1000)) : nowS,
        late: minutes(stop?.arr, stop?.schArr),
        next: t.eventName ?? stop?.name ?? "",
        from: t.origName ?? "",
        to: t.destName ?? "",
      });
    }
  }
  return out;
}

export const onRequestGet = async (): Promise<Response> => {
  try {
    const res = await fetch(URL, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) throw new Error(`${res.status}`);
    const now = Math.floor(Date.now() / 1000);
    const body: AmtrakResponse = { t: now, trains: amtrakRows((await res.json()) as Record<string, RawTrain[]>, now) };
    return json(body, 200, `public, max-age=${TTL_S}`);
  } catch (e) {
    return json({ error: `Amtrak's train tracking is unreachable (${String(e)}).` }, 502, `public, max-age=${RETRY_TTL_S}`);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
