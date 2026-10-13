/**
 * Cloudflare Pages Function: GET /api/image?cam=C909  or  ?photo=741695852.jpg
 *
 * The two kinds of picture the map shows in hover cards (a MnDOT traffic
 * camera's latest frame, an iNaturalist sighting's photo) are fetched here,
 * on the server, rather than by the visitor's browser. That way MnDOT and
 * Amazon never see the visitor's address, browser or location, only this
 * server; and one fetch per camera per ten seconds serves everyone.
 *
 * It is not an open proxy: the caller names a camera id or a photo id, never
 * a URL, each is checked against a strict pattern, and the upstream host is
 * fixed in this file.
 */
const CAMERA_BASE = "https://public.carsprogram.org/cameras/MN/";
const PHOTO_BASE = "https://inaturalist-open-data.s3.amazonaws.com/photos/";
const CAMERA_TTL_S = 10;
const PHOTO_TTL_S = 86_400;
/** A hover-card picture is small; anything bigger is not what we asked for. */
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 5000;
const IMAGE_TYPES = /^image\/(jpeg|png|webp)\b/i;
const UA = "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)";

const CAMERA_ID = /^[A-Za-z0-9._-]{1,80}$/;
const PHOTO_ID = /^\d{1,12}\/(medium|small|large|square)\.(jpe?g|png)$/i;

/** The upstream address for a request, or undefined if it isn't a valid one. */
export function upstreamFor(params: URLSearchParams): { url: string; ttl: number } | undefined {
  const cam = params.get("cam");
  const photo = params.get("photo");
  if (cam && !photo && CAMERA_ID.test(cam)) return { url: `${CAMERA_BASE}${encodeURIComponent(cam)}`, ttl: CAMERA_TTL_S };
  if (photo && !cam && PHOTO_ID.test(photo)) return { url: `${PHOTO_BASE}${photo}`, ttl: PHOTO_TTL_S };
  return undefined;
}

const fail = (status: number, message: string) =>
  new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const target = upstreamFor(new URL(request.url).searchParams);
  if (!target) return fail(400, "Ask for a camera (?cam=C909) or a photo (?photo=741695852/medium.jpg).");

  let res: Response;
  try {
    res = await fetch(target.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return fail(502, "The picture is unavailable right now.");
  }
  if (!res.ok) return fail(res.status === 404 ? 404 : 502, "No picture there.");
  if (!IMAGE_TYPES.test(res.headers.get("content-type") ?? "")) return fail(502, "Not a picture.");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return fail(502, "Too large.");
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(502, "Too large.");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type")!.split(";")[0],
      "cache-control": `public, max-age=${target.ttl}`,
      "x-content-type-options": "nosniff",
      // If anyone opens the address directly, it can't run anything.
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    },
  });
};
