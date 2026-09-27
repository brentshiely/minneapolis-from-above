/**
 * The well-known annual meteor showers: a small fixed table (peak dates are
 * calendar-stable year to year, so no orbital math is needed) and a check
 * for whether tonight is close enough to a peak to mention it.
 */

export interface Shower {
  name: string;
  /** Peak date, month 1-12. */
  month: number;
  day: number;
  /** Plain-language viewing tip. */
  tip: string;
}

export const showers: Shower[] = [
  { name: "Quadrantids", month: 1, day: 3, tip: "look north before dawn" },
  { name: "Lyrids", month: 4, day: 22, tip: "look northeast after midnight" },
  { name: "Eta Aquariids", month: 5, day: 5, tip: "look east before dawn" },
  { name: "Perseids", month: 8, day: 12, tip: "look northeast after midnight" },
  { name: "Orionids", month: 10, day: 21, tip: "look southeast after midnight" },
  { name: "Leonids", month: 11, day: 17, tip: "look east before dawn" },
  { name: "Geminids", month: 12, day: 13, tip: "look east after 9 PM" },
  { name: "Ursids", month: 12, day: 21, tip: "look north after midnight" },
];

/** How many days either side of a peak still counts as "peak night(s)". */
const TOLERANCE_DAYS = 2;

const TZ = "America/Chicago";
function localDate(d: Date): { y: number; m: number; day: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), day: Number(p.day) };
}

/** The shower whose peak `date` (Minneapolis local day) is closest to, if within a couple of days. */
export function nearPeak(date: Date): Shower | undefined {
  const { y, m, day } = localDate(date);
  const current = Date.UTC(y, m - 1, day);
  let best: { shower: Shower; diff: number } | undefined;
  for (const s of showers) {
    // Check the peak in the surrounding years too, so a late-December or
    // early-January date compares against the right nearby peak.
    for (const yy of [y - 1, y, y + 1]) {
      const diff = Math.abs(current - Date.UTC(yy, s.month - 1, s.day)) / 86_400_000;
      if (!best || diff < best.diff) best = { shower: s, diff };
    }
  }
  return best && best.diff <= TOLERANCE_DAYS ? best.shower : undefined;
}

/** A quiet one-line mention for the status bar, or nothing most nights. */
export function showerStatus(date: Date): string | undefined {
  const s = nearPeak(date);
  return s && `${s.name} peak tonight — ${s.tip}.`;
}
