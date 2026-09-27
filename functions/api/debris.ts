/**
 * Cloudflare Pages Function: GET /api/debris
 *
 * CelesTrak's tracked debris clouds in two-line format, concatenated and
 * passed through unparsed, cached 12 hours (debris orbits change slowly,
 * and CelesTrak allows one download per group per two hours). When any
 * group is declined, redirects to the snapshot baked on every deploy.
 */
const GROUPS = ["fengyun-1c-debris", "cosmos-2251-debris", "iridium-33-debris", "cosmos-1408-debris"];
const TTL_S = 12 * 3600;
const CACHE_KEY = "https://minneapolis-from-above.internal/debris";
const edgeCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

const toSnapshot = () =>
  new Response(null, { status: 307, headers: { location: "/data/debris.tle", "cache-control": "no-store" } });

export const onRequestGet = async (): Promise<Response> => {
  const cached = await edgeCache()?.match(CACHE_KEY);
  if (cached) return cached;
  try {
    const parts: string[] = [];
    for (const g of GROUPS) {
      const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, {
        headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      });
      const text = await res.text();
      if (!res.ok || !/^1 \d/m.test(text)) return toSnapshot();
      parts.push(text.trim());
    }
    const out = new Response(parts.join("\n") + "\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": `public, max-age=${TTL_S}` },
    });
    await edgeCache()?.put(CACHE_KEY, out.clone());
    return out;
  } catch {
    return toSnapshot();
  }
};
