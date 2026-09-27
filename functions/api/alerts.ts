import { decodeAlertFeed, EFFECT, type Alert, type AlertEntity } from "../_lib/gtfsrt.ts";

export const FEED_URL = "https://svc.metrotransit.org/mtgtfs/alerts.pb";

/** Alerts change far less often than positions; there's no need to hammer it. */
const EDGE_TTL_S = 60;

/**
 * One (alert, route) pair as [alertId, routeId, effect, header, description].
 * Rows instead of nested objects for the same reason as /api/vehicles.
 */
export type AlertRow = [string, string, number, string, string];

export interface AlertsResponse {
  /** Feed generation time, POSIX seconds. */
  t: number;
  a: AlertRow[];
}

/**
 * Effects that never move the drawn route line: they're about a stop,
 * an elevator, or an "everything's fine" notice, not the path buses or
 * trains take.
 */
const IGNORED_EFFECTS = new Set<number>([
  EFFECT.ACCESSIBILITY_ISSUE, EFFECT.STOP_MOVED, EFFECT.NO_EFFECT,
  EFFECT.ADDITIONAL_SERVICE, EFFECT.UNKNOWN_EFFECT,
]);

/** GTFS route_type for light rail, subway and commuter rail. */
const RAIL_ROUTE_TYPES = new Set([0, 1, 2]);

/**
 * Whether one alert is worth dashing a route for. Metro Transit tags a lot
 * of single-stop closures the same way it tags real detours (both often
 * come through as effect NO_SERVICE), so a stop-scoped entity doesn't
 * count on its own — riders just use the next stop over, the bus still
 * runs its normal path. Two things do count: an entity with no stop at
 * all (the whole route is affected, e.g. a street closed to a detour),
 * and any rail entity (replacement buses for a train line are always
 * worth knowing about, even when Metro Transit lists it station by
 * station).
 */
function isRouteWide(e: AlertEntity): boolean {
  return !e.stopId || RAIL_ROUTE_TYPES.has(e.routeType ?? -1);
}

/** The routes one alert actually affects, per the rule above. */
export function affectedRoutes(alert: Alert): string[] {
  if (alert.effect !== undefined && IGNORED_EFFECTS.has(alert.effect)) return [];
  const ids = new Set<string>();
  for (const e of alert.informedEntity) if (e.routeId && isRouteWide(e)) ids.add(e.routeId);
  return [...ids];
}

export function toResponse(bytes: Uint8Array): AlertsResponse {
  const feed = decodeAlertFeed(bytes);
  const t = feed.timestamp ?? Math.floor(Date.now() / 1000);
  const a: AlertRow[] = [];
  for (const alert of feed.alerts) {
    for (const routeId of affectedRoutes(alert)) {
      a.push([alert.id, routeId, alert.effect ?? EFFECT.UNKNOWN_EFFECT, alert.header, alert.description]);
    }
  }
  return { t, a };
}

/** Cloudflare Pages Function: GET /api/alerts */
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
