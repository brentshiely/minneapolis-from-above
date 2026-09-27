/**
 * Cloudflare Pages Function: GET /api/satellites
 *
 * Orbits for every active satellite from CelesTrak, in the compact
 * two-line format, passed through without parsing (it's ~2.6 MB; parsing
 * it here would blow Cloudflare's CPU budget). CelesTrak allows one
 * download per two hours, so answers are cached for six; when CelesTrak
 * declines, it redirects to the snapshot baked into each deploy.
 */
const SOURCE = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";
const TTL_S = 6 * 3600;
const CACHE_KEY = "https://minneapolis-from-above.internal/satellites";
const edgeCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

/** When CelesTrak declines, send the page to the deploy's snapshot instead of an error. */
const toSnapshot = (request?: Request) =>
  new Response(null, { status: 307, headers: { location: new URL("/data/satellites.tle", request?.url ?? "http://localhost/").pathname, "cache-control": "no-store" } });

export const onRequestGet = async ({ request }: { request?: Request } = {}): Promise<Response> => {
  const cached = await edgeCache()?.match(CACHE_KEY);
  if (cached) return cached;
  try {
    const res = await fetch(SOURCE, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
    const body = await res.text();
    // CelesTrak answers 200 with a plain-text note when it declines.
    if (!res.ok || !/^1 \d/m.test(body)) return toSnapshot(request);
    const out = new Response(body, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": `public, max-age=${TTL_S}` },
    });
    await edgeCache()?.put(CACHE_KEY, out.clone());
    return out;
  } catch {
    return toSnapshot(request);
  }
};
