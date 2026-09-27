/**
 * Cloudflare Pages Function: GET /api/satinfo?id=25544
 *
 * One satellite's catalog record from CelesTrak (owner, launch date and
 * site, object type, orbit, radar size). Records change rarely: cached
 * for a week.
 */
const TTL_S = 7 * 86_400;

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^\d{1,6}$/.test(id)) return json({ error: "Pass a NORAD catalog number, like 25544." }, 400);
  try {
    const res = await fetch(`https://celestrak.org/satcat/records.php?CATNR=${id}&FORMAT=json`, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return json({ error: `CelesTrak returned ${res.status}.` }, 502);
    const [r] = (await res.json()) as Record<string, unknown>[];
    if (!r) return json({ error: "No catalog record." }, 404);
    const pick = ["OBJECT_ID", "OBJECT_TYPE", "OWNER", "LAUNCH_DATE", "LAUNCH_SITE", "PERIOD", "INCLINATION", "APOGEE", "PERIGEE", "RCS"];
    return json(Object.fromEntries(pick.map((k) => [k, r[k]])), 200, `public, max-age=${TTL_S}`);
  } catch {
    return json({ error: "CelesTrak is unreachable." }, 502);
  }
};

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });
}
