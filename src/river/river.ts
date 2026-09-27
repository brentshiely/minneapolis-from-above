/**
 * Boats through the metro's two Mississippi locks, from the Army Corps of
 * Engineers' lock logs. These are passages (a boat went through a lock at
 * a time), not live positions, so the map draws each one at its lock and
 * lets it drift a little way in its direction of travel as it fades.
 * Everything here is pure so it can be tested without a map.
 */
import type { Description } from "../describe.ts";

export type LockNo = "01" | "02";

export interface Lock {
  no: LockNo;
  name: string;
  /** One plain sentence: what it is. */
  about: string;
  riverMile: number;
  /** The lock chamber. */
  at: [number, number];
  /**
   * The river's channel through the lock, upstream end first, as a few
   * points traced from the map; `lockIndex` is the lock's point.
   */
  path: [number, number][];
  lockIndex: number;
}

/** Upper St. Anthony Falls lock closed in 2015; these two still pass boats. */
export const LOCKS: Record<LockNo, Lock> = {
  "01": {
    no: "01", name: "Lock and Dam 1", riverMile: 847.6,
    about: "Lifts and lowers boats about 38 feet around the Ford Dam, between Minneapolis and Saint Paul.",
    at: [-93.2021, 44.9148],
    path: [
      [-93.19939, 44.92961], [-93.2, 44.92574], [-93.20061, 44.92145], [-93.20121, 44.91801], [-93.2021, 44.9148],
      [-93.2015, 44.9116], [-93.20061, 44.90898], [-93.19697, 44.90683], [-93.19272, 44.90425], [-93.19059, 44.89953],
    ],
    lockIndex: 4,
  },
  "02": {
    no: "02", name: "Lock and Dam 2", riverMile: 815.2,
    about: "Lifts and lowers boats about 12 feet around the dam just upstream of Hastings.",
    at: [-92.86776, 44.7596],
    path: [
      [-92.89661, 44.77584], [-92.88631, 44.77219], [-92.87687, 44.76731], [-92.87086, 44.76183], [-92.86776, 44.7596],
      [-92.86485, 44.75695], [-92.8597, 44.75269], [-92.85627, 44.74903], [-92.85112, 44.7469], [-92.84339, 44.74781],
      [-92.83481, 44.74842],
    ],
    lockIndex: 4,
  },
};

/** One boat through one lock. */
export interface Passage {
  lock: LockNo;
  /** The name as the Corps logs it, trimmed ("MARGARET D"); "" for recreational boats. */
  vessel: string;
  up: boolean;
  barges: number;
  /** POSIX seconds: when it reached the lock, and when it finished locking through. */
  arrived: number;
  done: number;
  /** A pleasure boat, logged without a name. */
  rec: boolean;
}

export interface RiverResponse {
  /** When the Corps' log was last checked, POSIX seconds. */
  t: number;
  /** Newest first. */
  p: Passage[];
}

// --- time ---------------------------------------------------------------------

const CHICAGO = "America/Chicago";
const wallFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
});

/** Minneapolis wall-clock time at an instant, as if it were UTC (ms). */
function wallMs(ms: number): number {
  const p = Object.fromEntries(wallFormat.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute);
}

/**
 * Lock logs carry Minneapolis wall-clock times with no offset (labeled
 * "CST" all year, but a lockmaster's clock follows daylight saving), so
 * they're read as Central time, standard or daylight as the date falls.
 */
export function centralTime(y: number, mo: number, d: number, h: number, mi: number): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let t = asUtc - (wallMs(asUtc) - asUtc);
  t = asUtc - (wallMs(t) - t);
  return t / 1000;
}

/** "09/26/26 13:49" (the lock queue) or "2026-09-26T13:49:00" (river at a glance). */
export function parseLockTime(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  let m = /^(\d\d)\/(\d\d)\/(\d\d) (\d\d):(\d\d)/.exec(s);
  if (m) return centralTime(2000 + Number(m[3]), Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5]));
  m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s);
  if (m) return centralTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
  return undefined;
}

// --- parsing --------------------------------------------------------------------

/** The Corps logs every pleasure boat under one placeholder vessel. */
const REC_VESSEL = "9999999";

interface QueueRow {
  vesselName?: string; vesselNo?: string; direction?: string; numBarges?: number | null;
  arrivalDate?: string; endOfLockage?: string;
}

/**
 * The lock queue: about a month of passages at one lock. A tow too long
 * for the chamber goes through in two cuts, logged twice with the same
 * arrival; those become one passage, done when the second cut is.
 */
export function parseQueue(lock: LockNo, rows: unknown): Passage[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<string, Passage>();
  for (const r of rows as QueueRow[]) {
    const arrived = parseLockTime(r.arrivalDate);
    const done = parseLockTime(r.endOfLockage) ?? arrived;
    if (arrived === undefined || done === undefined || (r.direction !== "U" && r.direction !== "D")) continue;
    const rec = r.vesselNo === REC_VESSEL;
    const p: Passage = {
      lock, vessel: rec ? "" : (r.vesselName ?? "").trim().replace(/\s+/g, " "), up: r.direction === "U",
      barges: Math.max(0, Number(r.numBarges) || 0), arrived, done, rec,
    };
    // Pleasure boats share one name, so each of their rows is its own passage.
    const key = rec ? `${byKey.size}` : `${r.vesselNo}|${p.up}|${arrived}`;
    const prev = byKey.get(key);
    if (prev) { prev.done = Math.max(prev.done, done); prev.barges = Math.max(prev.barges, p.barges); } else byKey.set(key, p);
  }
  return [...byKey.values()];
}

/**
 * River at a glance lists only the latest lockage at each lock; its rows
 * say whether anything new has come through since the last full check.
 */
export function glanceSignature(rows: unknown): string {
  if (!Array.isArray(rows)) return "";
  return (rows as { lockNo?: string; vesselNo?: string; endOfLockage?: string }[])
    .filter((r) => r.lockNo === "01" || r.lockNo === "02")
    .map((r) => `${r.lockNo}|${r.vesselNo}|${r.endOfLockage}`)
    .sort().join(",");
}

/** How many past passages each lock keeps for its tooltip, however old. */
export const KEEP_PER_LOCK = 3;
/** Beyond those, the last day's passages. */
const KEEP_S = 24 * 3600;

/** Both locks' passages, newest first, trimmed to what the map uses. */
export function mergePassages(lists: Passage[][], nowS: number): Passage[] {
  const all = lists.flat().sort((a, b) => b.done - a.done);
  const seen: Record<string, number> = {};
  return all.filter((p) => (seen[p.lock] = (seen[p.lock] ?? 0) + 1) <= KEEP_PER_LOCK || nowS - p.done < KEEP_S);
}

// --- on the map -------------------------------------------------------------------

/** How long a passage stays on the map, and how far it drifts meanwhile. */
export const TOW_WINDOW_S = 4 * 3600;
export const REC_WINDOW_S = 2 * 3600;
const TOW_DRIFT_M = 1200;
const REC_DRIFT_M = 500;

export interface Boat {
  /** Stable across refreshes, for hover. */
  key: string;
  p: Passage;
  position: [number, number];
  /** Compass degrees, the way it's heading. */
  heading: number;
  alpha: number;
}

export const passageKey = (p: Passage) => `${p.lock}|${p.done}|${p.vessel}|${p.up ? "U" : "D"}`;

const M_PER_DEG = 111_320;

/** A point `meters` along a path from one of its points, forward or backward, with the heading there. */
export function alongPath(path: [number, number][], from: number, meters: number, forward: boolean): { position: [number, number]; heading: number } {
  const step = forward ? 1 : -1;
  let i = from;
  let left = meters;
  let heading = 0;
  let position: [number, number] = path[from];
  while (i + step >= 0 && i + step < path.length) {
    const a = path[i], b = path[i + step];
    const k = Math.cos((a[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * k * M_PER_DEG, dy = (b[1] - a[1]) * M_PER_DEG;
    const len = Math.hypot(dx, dy);
    heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    if (len >= left) {
      const f = len ? left / len : 0;
      return { position: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading };
    }
    left -= len;
    position = b;
    i += step;
  }
  return { position, heading };
}

/** The river flows downstream from the upstream end of each lock's path. */
export const downstream = (lock: Lock) => alongPath(lock.path, lock.lockIndex, 1, true).heading;

/**
 * Recent passages as boats near their locks: each starts at the lock
 * and drifts gently in its direction of travel, fading over its window.
 */
export function boatsAt(passages: Passage[], nowS: number): Boat[] {
  const boats: Boat[] = [];
  for (const p of passages) {
    const window = p.rec ? REC_WINDOW_S : TOW_WINDOW_S;
    const age = Math.max(0, nowS - p.done);
    if (age >= window) continue;
    const f = age / window;
    const lock = LOCKS[p.lock];
    // Quick at first, then settling: far enough to show direction, never a track.
    const eased = 1 - (1 - f) * (1 - f);
    const { position, heading } = alongPath(lock.path, lock.lockIndex, eased * (p.rec ? REC_DRIFT_M : TOW_DRIFT_M), !p.up);
    const x = Math.min(1, Math.max(0, (f - 0.6) / 0.4));
    boats.push({ key: passageKey(p), p, position, heading, alpha: 1 - x * x * (3 - 2 * x) });
  }
  return boats;
}

// --- words ------------------------------------------------------------------------

/** Letters-only words without vowels are initials or abbreviations: keep them in capitals. */
const KEEP_CAPS = /^[B-DF-HJ-NP-TV-Z]+$/;
const SPELLING: Record<string, string> = { MISSISSPPI: "Mississippi" };

/** "MARGARET D" -> "Margaret D"; "HFL MARINER" -> "HFL Mariner". */
export function vesselName(raw: string): string {
  return raw.trim().split(/\s+/).map((w) => {
    if (SPELLING[w]) return SPELLING[w];
    if (w.length === 1 || KEEP_CAPS.test(w) || /\d/.test(w)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(" ");
}

/** Boats that aren't towboats, by the name the Corps logs. */
const PASSENGER: Record<string, string> = {
  "ANSON NORTHRUP": "Riverboat", "JONATHAN PADELFORD": "Riverboat", "JOSIAH SNELLING": "Riverboat",
  "MINNEAPOLIS QUEEN": "Riverboat", "VIKING MISSISSPPI": "Cruise ship", "VIKING MISSISSIPPI": "Cruise ship",
  "AMERICAN SERENADE": "Cruise ship", "AMERICAN COUNTRY": "Cruise ship", "AMERICAN HERITAGE": "Cruise ship",
};

/** "Towboat Margaret D", "Riverboat Anson Northrup", "Coast Guard cutter Wyaconda", "A recreational boat". */
export function boatName(p: Passage): string {
  if (p.rec) return "A recreational boat";
  if (p.vessel.startsWith("USCG ")) return `Coast Guard cutter ${vesselName(p.vessel.slice(5))}`;
  if (!p.vessel) return "A boat";
  return `${PASSENGER[p.vessel] ?? "Towboat"} ${vesselName(p.vessel)}`;
}

const bargeWords = (n: number) => (n === 0 ? "no barges" : n === 1 ? "1 barge" : `${n} barges`);

const clockFormat = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, weekday: "long" });
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: CHICAGO, month: "long", day: "numeric" });
const dayNumber = (s: number) => Math.floor(wallMs(s * 1000) / 86_400_000);

/** "at 1:49 PM", "yesterday at 9:18 PM", "on Thursday at 7:59 AM", "on September 12 at 1:56 PM". */
export function when(s: number, nowS: number): string {
  // Newer ICU puts a narrow no-break space before AM/PM.
  const clock = `at ${clockFormat.format(new Date(s * 1000)).replace(/\s/g, " ")}`;
  const days = dayNumber(nowS) - dayNumber(s);
  if (days <= 0) return clock;
  if (days === 1) return `yesterday ${clock}`;
  if (days < 7) return `on ${dayFormat.format(new Date(s * 1000))} ${clock}`;
  return `on ${dateFormat.format(new Date(s * 1000))} ${clock}`;
}

export function ago(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 1) return "just now";
  if (m < 60) return m === 1 ? "a minute ago" : `${m} minutes ago`;
  const h = Math.round(m / 60);
  return h === 1 ? "an hour ago" : `${h} hours ago`;
}

/** "heading upstream with 3 barges", or just "heading downstream" for a pleasure boat. */
function travel(p: Passage): string {
  const way = `heading ${p.up ? "upstream" : "downstream"}`;
  if (p.rec) return way;
  return p.barges ? `${way} with ${bargeWords(p.barges)}` : `${way}, ${bargeWords(0)}`;
}

/** "Towboat Margaret D heading upstream with 3 barges, through Lock and Dam 2 at 12:49 PM." */
export function describePassage(p: Passage, nowS: number): Description {
  return {
    title: `${boatName(p)} ${travel(p)}, through ${LOCKS[p.lock].name} ${when(p.done, nowS)}.`,
    detail: "Drawn near the lock where it was logged, not where it is now.",
    meta: `Army Corps of Engineers lock log · ${ago(nowS - p.done)}`,
  };
}

/** "Last through: Anson Northrup, heading downstream, no barges, at 1:49 PM." */
export function describeLock(lock: Lock, passages: Passage[], nowS: number): Description {
  const last = passages.filter((p) => p.lock === lock.no).sort((a, b) => b.done - a.done).slice(0, KEEP_PER_LOCK);
  const said = last.map((p) => {
    const who = p.rec ? "a recreational boat" : p.vessel.startsWith("USCG ") ? boatName(p) : vesselName(p.vessel);
    return `${who}, ${travel(p)}, ${when(p.done, nowS)}`;
  });
  return {
    title: `${lock.name}.`,
    detail: `${lock.about} ${said.length ? `Last through: ${said.join("; ")}.` : "No boats logged here in the last month."}`,
    meta: `Mississippi River mile ${lock.riverMile} · Army Corps of Engineers`,
  };
}
