/**
 * Cloudflare Pages Function: GET /api/snow
 *
 * Whether Minneapolis or Saint Paul has declared a snow emergency, read
 * from each city's own website (see src/snow/status.ts), with the day or
 * phase it's in. Cached for 5 minutes. A city whose page can't be read
 * reports `ok: false` and no emergency, so the map stays quiet.
 */
import { MPLS_SOURCE, STP_SOURCE, parseMinneapolis, parseSaintPaul } from "../../src/snow/status.ts";
import { stageAt, type CityStatus, type SnowResponse } from "../../src/snow/rules.ts";

const CACHE_S = 300;
/** A city's last good answer stands in through a brief outage. */
const STALE_OK_S = 1800;

const last: Partial<Record<"mpls" | "stp", { at: number; status: CityStatus }>> = {};

/** For tests. */
export function resetSnowCache() { delete last.mpls; delete last.stp; }

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
    cf: { cacheTtl: CACHE_S, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned ${res.status}.`);
  return res;
}

async function city(key: "mpls" | "stp", read: () => Promise<CityStatus>, source: string): Promise<CityStatus> {
  const now = Date.now() / 1000;
  try {
    const status = await read();
    if (status.ok) { last[key] = { at: now, status }; return status; }
  } catch { /* fall through to the last good answer */ }
  const prev = last[key];
  if (prev && now - prev.at < STALE_OK_S) return prev.status;
  return { declared: false, ok: false, source };
}

export const onRequestGet = async (): Promise<Response> => {
  const now = new Date();
  const [mplsRead, stpRead] = await Promise.all([
    // The notice feed is JSON with a stray trailing blank; parse the text.
    city("mpls", async () => parseMinneapolis(JSON.parse(await (await get(`${MPLS_SOURCE}?ver=${Math.floor(now.getTime() / (CACHE_S * 1000))}`)).text()), now), MPLS_SOURCE),
    city("stp", async () => parseSaintPaul(await (await get(STP_SOURCE)).text(), now), STP_SOURCE),
  ]);
  // Where each emergency stands right now: the day or phase, and whether it has started.
  const mplsStage = stageAt("mpls", mplsRead, now), stpStage = stageAt("stp", stpRead, now);
  const mpls: CityStatus = mplsStage?.city === "mpls" ? { ...mplsRead, day: mplsStage.day, before: mplsStage.before } : mplsRead;
  const stp: CityStatus = stpStage?.city === "stp" ? { ...stpRead, phase: stpStage.phase, before: stpStage.before } : stpRead;
  const body: SnowResponse = { t: Math.floor(now.getTime() / 1000), mpls, stp };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_S}` },
  });
};
