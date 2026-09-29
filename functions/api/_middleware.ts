import { edgeCached } from "../_lib/edgecache.ts";

/** Runs in front of every /api endpoint: see functions/_lib/edgecache.ts. */
export const onRequest = (ctx: { request: Request; next: () => Promise<Response>; waitUntil: (p: Promise<unknown>) => void }) => edgeCached(ctx);
