/**
 * Cloudflare Pages Function: GET /api/river
 *
 * Boats through Lock and Dam 1 and Lock and Dam 2 on the Mississippi, from
 * the Army Corps of Engineers' Lock Performance Monitoring System (public
 * domain; no keys, no CORS, so it comes through here).
 *
 * The Corps allows 5 requests a minute, total. So: river at a glance (one
 * request) says whether anything new has locked through; only then are the
 * two locks' queues fetched (two more). Answers are cached for 5 minutes in
 * Cloudflare's cache, shared by every viewer at a location, and in memory;
 * the last good answer is kept for a week and served whenever the Corps is
 * busy or refuses. Every upstream request also spends from a per-instance
 * budget of 5 a minute, so even a burst of cache misses can't exceed it.
 */
import { glanceSignature, mergePassages, parseQueue, type LockNo, type RiverResponse } from "../../src/river/river.ts";

const LPMS = "https://ndc.ops.usace.army.mil/ords/lpms/json";
/** River miles 800–860 of the Mississippi: both locks. */
export const GLANCE_URL = `${LPMS}/river_at_a_glance/MI/800/860`;
export const queueUrl = (lock: LockNo) => `${LPMS}/lock_queue_json?in_river=MI&in_lock=${lock}`;

/** Boats take half an hour to lock through; checking every 5 minutes is plenty. */
export const FRESH_S = 300;
/** Passages are history: a week-old list is still true, just not recent. */
const LAST_OK_S = 7 * 86400;

/** The Corps' limit, spent per instance over a rolling minute. */
export const BUDGET_PER_MIN = 5;
let spent: number[] = [];
function spend(n: number, nowS: number): boolean {
  spent = spent.filter((t) => nowS - t < 60);
  if (spent.length + n > BUDGET_PER_MIN) return false;
  for (let i = 0; i < n; i++) spent.push(nowS);
  return true;
}

/**
 * The service labels its JSON text/html, and says "Rate limit exceeded"
 * as a JSON object where a list belongs.
 */
async function getList(url: string): Promise<unknown[]> {
  const res = await fetch(url, { headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" } });
  if (!res.ok) throw new Error(`The Corps' lock service returned ${res.status}.`);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch {
    throw new Error(`The Corps' lock service sent something unreadable: "${text.replace(/<[^>]*>|\s+/g, " ").trim().slice(0, 80)}".`);
  }
  if (!Array.isArray(body)) {
    const said = (body as { error?: unknown })?.error;
    throw new Error(typeof said === "string" ? `The Corps' lock service said: ${said}` : "The Corps' lock service sent no list.");
  }
  return body;
}

interface Kept { at: number; sig: string; body: RiverResponse }
/** The last good answer in this instance, and the signature of the glance it came from. */
let last: Kept | undefined;
/** After a failure, this instance doesn't ask the Corps again until then. */
let nextTry = 0;
let lastError = "";

/** For tests. */
export function resetRiverCache() { last = undefined; spent = []; nextTry = 0; lastError = ""; inflight = undefined; }

/** Cloudflare's per-location cache, shared by every instance there (absent in Node). */
const FRESH_KEY = "https://minneapolis-from-above.internal/river";
const LAST_KEY = "https://minneapolis-from-above.internal/river-last";
const edgeCache = () => (globalThis as { caches?: { default?: Cache } }).caches?.default;

async function lastGood(): Promise<Kept | undefined> {
  if (last) return last;
  const res = await edgeCache()?.match(LAST_KEY);
  return res ? (last = (await res.json()) as Kept) : undefined;
}

export const onRequestGet = async (): Promise<Response> => {
  const now = Date.now() / 1000;
  if (last && now - last.at < FRESH_S) return json(last.body, 200, `public, max-age=${Math.ceil(FRESH_S - (now - last.at))}`);
  const cached = await edgeCache()?.match(FRESH_KEY);
  if (cached) return cached;
  if (now < nextTry) return stale(last, now, lastError);
  // Viewers arriving together share one check.
  inflight ??= refresh(now).finally(() => { inflight = undefined; });
  return (await inflight).clone();
};

let inflight: Promise<Response> | undefined;

async function refresh(now: number): Promise<Response> {
  const prev = await lastGood();
  try {
    if (!spend(1, now)) throw new Error("Waiting a minute to stay within the Corps' request limit.");
    const sig = glanceSignature(await getList(GLANCE_URL));
    let body: RiverResponse;
    if (prev && sig && sig === prev.sig) {
      // Nothing new has locked through: the queues haven't changed.
      body = { t: Math.floor(now), p: prev.body.p };
    } else {
      if (!spend(2, now)) throw new Error("Waiting a minute to stay within the Corps' request limit.");
      // One after the other: the service is small, and gentler asked one at a time.
      const one = await getList(queueUrl("01"));
      const two = await getList(queueUrl("02"));
      body = { t: Math.floor(now), p: mergePassages([parseQueue("01", one), parseQueue("02", two)], now) };
    }
    last = { at: now, sig, body };
    nextTry = 0;
    const res = json(body, 200, `public, max-age=${FRESH_S}`);
    await edgeCache()?.put(FRESH_KEY, res.clone());
    await edgeCache()?.put(LAST_KEY, json(last, 200, `public, max-age=${LAST_OK_S}`));
    return res;
  } catch (err) {
    // Serve what we had, and don't ask again here for another 5 minutes.
    nextTry = now + FRESH_S;
    lastError = err instanceof Error ? err.message : "The Corps' lock service is unreachable.";
    const res = stale(prev, now, lastError);
    await edgeCache()?.put(FRESH_KEY, res.clone());
    return res;
  }
}

/**
 * The last good answer while the Corps is busy; with nothing kept, an
 * honest empty answer (no passages, and why) rather than an error in
 * every visitor's console. The page simply shows a quiet river.
 */
function stale(prev: Kept | undefined, now: number, error: string): Response {
  return prev && now - prev.at < LAST_OK_S
    ? json(prev.body, 200, `public, max-age=${FRESH_S}`)
    : json({ t: Math.floor(now), p: [], unavailable: error }, 200, `public, max-age=${FRESH_S}`);
}

function json(body: unknown, status: number, cache = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache },
  });
}
