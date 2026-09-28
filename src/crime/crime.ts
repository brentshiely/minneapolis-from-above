/**
 * Recently reported crime incidents in Minneapolis and Saint Paul,
 * fading out over a couple of days as they age. Minneapolis publishes a
 * block-centroid point for each incident; Saint Paul publishes only a
 * district number, so its incidents are placed at a deterministic
 * (never-jumping) random spot inside their real district instead of
 * stacking on one shared pin.
 */
import type { CrimeIncident, CrimeResponse, City } from "../../functions/api/crime.ts";
import type { Description } from "../describe.ts";

export type { CrimeIncident, CrimeResponse, City };

/** Days after which an incident is fully faded and no longer shown. */
export const FADE_DAYS = 2;

export interface StPaulDistrict {
  name: string;
  center: [number, number];
  radiusM: number;
}
export type StPaulDistricts = Record<number, StPaulDistrict>;

export async function loadStPaulDistricts(url = "/data/stpaul-districts.json"): Promise<StPaulDistricts> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load Saint Paul's district boundaries (${res.status}).`);
  return res.json();
}

/** 1 (just reported) fading to 0 (fully aged out); never negative. */
export function crimeStrength(c: CrimeIncident, nowS: number): number {
  const ageDays = (nowS - c.reportedAt) / 86_400;
  return Math.max(0, Math.min(1, 1 - ageDays / FADE_DAYS));
}

/** A tiny seeded PRNG so a Saint Paul incident's jittered spot never moves between polls. */
function seededUnit(seed: string): [number, number] {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return [(h1 >>> 0) / 4294967296, (h2 >>> 0) / 4294967296];
}

const M_PER_DEG_LAT = 111_320;

/** Where an incident actually draws: Minneapolis's own point, or a stable random spot inside Saint Paul's district. */
export function crimePosition(c: CrimeIncident, districts: StPaulDistricts): [number, number] | undefined {
  if (c.position) return c.position;
  if (c.stpaulDistrict == null) return undefined;
  const d = districts[c.stpaulDistrict];
  if (!d) return undefined;
  const [ra, rb] = seededUnit(c.id);
  const angle = ra * 2 * Math.PI;
  const radiusM = Math.sqrt(rb) * d.radiusM; // sqrt for a uniform spread over the area, not bunched at the center
  const kx = M_PER_DEG_LAT * Math.cos((d.center[1] * Math.PI) / 180);
  return [d.center[0] + (Math.sin(angle) * radiusM) / kx, d.center[1] + (Math.cos(angle) * radiusM) / M_PER_DEG_LAT];
}

function ago(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 1) return "just now";
  if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "a day ago" : `${d} days ago`;
}

/** "1234 Main St" reads better than the source's "0012XX MAIN ST" masking. */
function place(block: string | undefined): string {
  if (!block) return "";
  return block.replace(/^0*(\d*)XX\b/i, (_, n) => (n ? `${n}00 block` : "block")).trim();
}

export function describeCrime(c: CrimeIncident, nowS: number): Description {
  const where = [place(c.block), c.neighborhood].filter(Boolean).join(", ");
  const title = `${c.category}${where ? `, ${where}` : ""}.`;
  return { title, detail: `Reported ${ago(nowS - c.reportedAt)} in ${c.city}.`, meta: c.city };
}

const PREVIEW: CrimeIncident = {
  id: "preview-1", city: "Minneapolis", category: "Automobile Theft",
  reportedAt: 0, neighborhood: "Downtown West", block: "0012XX HENNEPIN AVE", position: [-93.273, 44.978],
};

/** `?crime=preview` shows one recent incident, without waiting on the real feed. */
export function previewCrime(spec: string): CrimeResponse | undefined {
  if (spec.trim().toLowerCase() !== "preview") return undefined;
  const t = Math.floor(Date.now() / 1000);
  return { t, incidents: [{ ...PREVIEW, reportedAt: t - 3 * 3600 }] };
}
