/**
 * Cloudflare Pages Function: GET /api/radar-tile?m=05&z=8&x=61&y=92
 *
 * Proxies one NEXRAD tile from Iowa Environmental Mesonet. IEM already
 * answers the browser directly with an open CORS header, so this isn't
 * here for access — it's here because MapLibre's own tile fetch (fetch()
 * + createImageBitmap()) throws "the source image could not be decoded"
 * on IEM's response in a way a plain <img> tag or a manual fetch never
 * does, even for byte-identical, standard, non-paletted PNGs. Serving
 * the same bytes back from our own domain avoids whatever that
 * interaction is.
 */
const UA = "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)";
/** Matches IEM's own edge cache lifetime for this product. */
const TTL_S = 300;

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const m = params.get("m") ?? "";
  const z = params.get("z") ?? "";
  const x = params.get("x") ?? "";
  const y = params.get("y") ?? "";
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return new Response("Bad tile request.", { status: 400 });
  }
  const nn = m.padStart(2, "0");
  const upstream = `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-m${nn}m-900913/${z}/${x}/${y}.png`;

  let res: Response;
  try {
    res = await fetch(upstream, {
      headers: { "user-agent": UA },
      cf: { cacheTtl: TTL_S, cacheEverything: true },
    } as RequestInit);
  } catch {
    return new Response("IEM's radar tile cache is unreachable.", { status: 502 });
  }
  if (!res.ok) return new Response(`IEM returned ${res.status}.`, { status: 502 });

  const body = await res.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: { "content-type": "image/png", "cache-control": `public, max-age=${TTL_S}` },
  });
};
