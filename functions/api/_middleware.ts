import { edgeCached } from "../_lib/edgecache.ts";

/**
 * Runs in front of every /api endpoint: the shared edge cache (see
 * functions/_lib/edgecache.ts), then the protections that public/_headers
 * can't give Function answers: no sniffing, never embedded or read by
 * another site, and no referrer.
 */
export const onRequest = async (ctx: { request: Request; next: () => Promise<Response>; waitUntil: (p: Promise<unknown>) => void }) => {
  const res = await edgeCached(ctx);
  const headers = new Headers(res.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("referrer-policy", "no-referrer");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
