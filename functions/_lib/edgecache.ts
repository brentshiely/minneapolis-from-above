/**
 * A shared edge cache in front of every /api endpoint.
 *
 * Pages Functions run before Cloudflare's CDN cache, so a Cache-Control
 * header alone never spares a request the handler (the upstream fetch, the
 * decode, the JSON encode). This wraps a finished response in the colo's
 * Cache API instead:
 *
 * - one handler run per endpoint per TTL per colo, however many visitors;
 * - concurrent misses share one run (no stampede while the cache is cold);
 * - a fresh-enough stale copy is served instantly while one request
 *   refreshes it in the background;
 * - when the handler fails, a stale copy beats an error;
 * - the cache key keeps only each endpoint's real parameters, so a
 *   cache-busting `?x=random` can't reach the upstream feeds.
 */

/** The query parameters each endpoint actually reads. Anything else is ignored. */
const PARAMS: Record<string, string[]> = {
  "/api/water": ["lid"],
  "/api/satinfo": ["id"],
  "/api/flight": ["callsign", "hex"],
  "/api/radar-tile": ["m", "z", "x", "y"],
};

/** Longest a stale copy may be served in place of a failing handler. */
const STALE_IF_ERROR_S = 3600;

/** ttl 0: not cacheable (an error, or no-store): passed through as it came. */
interface Stored { status: number; headers: [string, string][]; body: ArrayBuffer; at: number; ttl: number }

/** Cache API subset used here, so tests can pass a fake. */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

const inflight = new Map<string, Promise<Stored>>();

export function cacheKey(url: URL): string {
  const allowed = PARAMS[url.pathname] ?? [];
  const kept = allowed.flatMap((k) => url.searchParams.has(k) ? [`${k}=${url.searchParams.get(k)}`] : []).sort();
  return `https://edge.internal${url.pathname}${kept.length ? `?${kept.join("&")}` : ""}`;
}

const maxAge = (cc: string | null): number => (cc && !/no-store|private/.test(cc) ? Number(/max-age=(\d+)/.exec(cc)?.[1] ?? 0) : 0);

async function runHandler(next: () => Promise<Response>): Promise<Stored> {
  const res = await next();
  const ttl = res.status === 200 ? maxAge(res.headers.get("cache-control")) : 0;
  return { status: res.status, headers: [...res.headers], body: await res.arrayBuffer(), at: Date.now(), ttl };
}

function respond(s: Stored, state: string): Response {
  const age = Math.floor((Date.now() - s.at) / 1000);
  const headers = new Headers(s.headers);
  if (s.ttl) headers.set("cache-control", `public, max-age=${Math.max(0, s.ttl - age)}`);
  headers.set("x-edge-cache", state);
  headers.set("age", String(age));
  return new Response(s.body.slice(0), { status: s.status, headers });
}

async function read(cache: CacheLike, key: string): Promise<Stored | undefined> {
  const hit = await cache.match(key);
  if (!hit) return undefined;
  const at = Number(hit.headers.get("x-edge-at"));
  const ttl = Number(hit.headers.get("x-edge-ttl"));
  if (!at || !ttl) return undefined;
  const headers = [...hit.headers].filter(([k]) => !/^(x-edge-|cache-control$|age$)/.test(k));
  return { status: hit.status, headers, body: await hit.arrayBuffer(), at, ttl };
}

function write(cache: CacheLike, key: string, s: Stored): Promise<void> {
  const headers = new Headers(s.headers);
  headers.set("x-edge-at", String(s.at));
  headers.set("x-edge-ttl", String(s.ttl));
  // The colo keeps it long enough to serve as a fallback; freshness is ours to judge.
  headers.set("cache-control", `public, max-age=${Math.min(STALE_IF_ERROR_S, Math.max(s.ttl * 10, 120))}`);
  return cache.put(key, new Response(s.body.slice(0), { status: s.status, headers }));
}

export interface EdgeContext {
  request: Request;
  next: () => Promise<Response>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export async function edgeCached(ctx: EdgeContext, cache: CacheLike | undefined = (globalThis as { caches?: { default?: Cache } }).caches?.default): Promise<Response> {
  if (ctx.request.method !== "GET" || !cache) return ctx.next();
  const key = cacheKey(new URL(ctx.request.url));
  const wait = (p: Promise<unknown>) => (ctx.waitUntil ? ctx.waitUntil(p.catch(() => {})) : void p.catch(() => {}));

  /** One handler run and store, shared by every concurrent caller. */
  const refresh = (): Promise<Stored> => {
    let p = inflight.get(key);
    if (!p) {
      p = runHandler(ctx.next).then(async (out) => {
        if (out.ttl) await write(cache, key, out).catch(() => {});
        return out;
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };

  const stored = await read(cache, key).catch(() => undefined);
  const age = stored ? (Date.now() - stored.at) / 1000 : Infinity;
  if (stored && age < stored.ttl) return respond(stored, "HIT");
  // Slightly stale: answer now, refresh behind the scenes.
  if (stored && age < stored.ttl + Math.min(stored.ttl, 30)) {
    const p = refresh();
    p.catch(() => {});
    wait(p);
    return respond(stored, "STALE");
  }
  const shared = inflight.has(key);
  try {
    const out = await refresh();
    // A failing handler: an older good copy beats passing the error on.
    if (!out.ttl && out.status >= 500 && stored && age < STALE_IF_ERROR_S) return respond(stored, "STALE-ERROR");
    return respond(out, shared ? "COALESCED" : out.ttl ? "MISS" : "BYPASS");
  } catch {
    if (stored && age < STALE_IF_ERROR_S) return respond(stored, "STALE-ERROR");
    return new Response(JSON.stringify({ error: "This feed is unavailable." }), { status: 502, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
}
