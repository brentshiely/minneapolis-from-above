/**
 * Snow emergency parking rules for Minneapolis and Saint Paul, day by day,
 * in plain language, and which day or phase applies at a given moment.
 *
 * Minneapolis rules: https://www.minneapolismn.gov/getting-around/snow/snow-emergencies/snow-parking-rules/
 *   Day 1, from 9 p.m. the day it's declared: no parking on either side of
 *     snow emergency routes until they're fully plowed.
 *   Day 2, 8 a.m. to 8 p.m.: no parking on the even side of streets that
 *     aren't snow emergency routes, or on either side of parkways.
 *   Day 3, 8 a.m. to 8 p.m.: no parking on the odd side of streets that
 *     aren't snow emergency routes.
 *   Any street is fine to park on once it's fully plowed.
 *
 * Saint Paul rules: https://www.stpaul.gov/departments/public-works/snow/saint-paul-snow-emergency-parking-rules
 *   Night plow, from 9 p.m. the day it's declared (plowed 9 p.m. to 7 a.m.):
 *     no parking on streets signed "Night Plow Route", or anywhere downtown.
 *   Day plow, from 8 a.m. the next day (plowed 8 a.m. to 5 p.m.): no parking
 *     on streets without Night Plow Route signs until plowed to the curb.
 *   Cleanup, up to 96 hours from the start: don't park where the street
 *     isn't plowed to the curb.
 */

export type City = "mpls" | "stp";
export type MplsDay = 1 | 2 | 3;
export type StpPhase = "night" | "day" | "cleanup";

/** One city's snow emergency, as the status endpoint reports it. */
export interface CityStatus {
  declared: boolean;
  /** Minneapolis date the emergency was declared, "2026-01-07", when known. */
  declaredOn?: string;
  /** Minneapolis: which day of it the city says it is. */
  day?: MplsDay;
  /** Saint Paul: which phase the city says it is. */
  phase?: StpPhase;
  /** That day or phase is announced but hasn't started (day 1 at 9 PM, day 3 at 8 AM). */
  before?: boolean;
  /** When the city's current notice runs out (ISO time), if it says. */
  until?: string;
  /** The city's own words, for reference. */
  message?: string;
  /** Where the answer came from. */
  source: string;
  /** False when the source couldn't be read; the map then shows nothing. */
  ok: boolean;
}

export interface SnowResponse {
  /** POSIX seconds this answer was made. */
  t: number;
  mpls: CityStatus;
  stp: CityStatus;
}

/** Where a declared emergency stands right now, or undefined when it's over. */
export type Stage =
  | { city: "mpls"; day: MplsDay; /** Announced, not started: day 1 at 9 PM, day 3 at 8 AM. */ before?: boolean }
  | { city: "stp"; phase: StpPhase; before?: boolean };

/** Minneapolis wall-clock date parts of a moment. */
export function localParts(at: Date): { y: number; m: number; d: number; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hour: Number(p.hour) + Number(p.minute) / 60 };
}

/** "2026-01-07" for a Minneapolis date. */
export const isoDate = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The moment it's `hour` o'clock on a Minneapolis date. */
export function localTime(iso: string, hour: number): Date {
  const hh = String(hour).padStart(2, "0");
  // Central Standard Time, unless that date is on daylight time.
  const cst = new Date(`${iso}T${hh}:00:00-06:00`);
  return localParts(cst).hour === hour ? cst : new Date(`${iso}T${hh}:00:00-05:00`);
}

/** Days from a "YYYY-MM-DD" date to the Minneapolis date of `at`. */
function daysSince(declaredOn: string, at: Date): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(declaredOn);
  if (!m) return undefined;
  const l = localParts(at);
  return Math.round((Date.UTC(l.y, l.m - 1, l.d) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000);
}

/**
 * Which Minneapolis day it is, `n` days after the declaration at local
 * hour `hour`, as the city schedules its notices: declared (until 9 p.m.),
 * day 1 (9 p.m. to 8 a.m.), day 2 (8 a.m. to 8 p.m.), overnight before
 * day 3 (8 p.m. to 8 a.m.), day 3 (8 a.m. to 8 p.m.), then it's over.
 */
export function mplsDayAt(n: number, hour: number): { day: MplsDay; before?: boolean } | undefined {
  if (n === 0) return hour < 21 ? { day: 1, before: true } : { day: 1 };
  if (n === 1) return hour < 8 ? { day: 1 } : hour < 20 ? { day: 2 } : { day: 3, before: true };
  if (n === 2) return hour < 8 ? { day: 3, before: true } : hour < 20 ? { day: 3 } : undefined;
  return undefined;
}

/**
 * Which Saint Paul phase it is, `n` days after the declaration at local
 * hour `hour`. Night plow starts at 9 p.m., day plow at 8 a.m. the next
 * day, and the emergency lasts 96 hours from 9 p.m.
 */
export function stpPhaseAt(n: number, hour: number): { phase: StpPhase; before?: boolean } | undefined {
  if (n === 0) return hour < 21 ? { phase: "night", before: true } : { phase: "night" };
  if (n === 1) return hour < 7 ? { phase: "night" } : hour < 8 ? { phase: "day", before: true } : hour < 17 ? { phase: "day" } : { phase: "cleanup" };
  if (n >= 2 && (n < 4 || (n === 4 && hour < 21))) return { phase: "cleanup" };
  return undefined;
}

/**
 * Where a city's emergency stands at `at`, from its status. The city's own
 * words for the day or phase come first while its notice lasts; after
 * that, the clock from the declaration date. A declaration date that says
 * it's all over outranks words that were never taken down.
 */
export function stageAt(city: City, s: CityStatus | undefined, at: Date): Stage | undefined {
  if (!s?.ok || !s.declared) return undefined;
  const n = s.declaredOn ? daysSince(s.declaredOn, at) : undefined;
  const hour = localParts(at).hour;
  const byClock = n === undefined || n < 0 ? undefined : city === "mpls" ? mplsDayAt(n, hour) : stpPhaseAt(n, hour);
  const current = !s.until || at.getTime() < Date.parse(s.until);
  const said = city === "mpls" ? s.day && { day: s.day } : s.phase && { phase: s.phase };
  if (said && current && !(s.declaredOn && !byClock)) return { city, ...said, ...(s.before ? { before: true } : {}) } as Stage;
  return byClock && ({ city, ...byClock } as Stage);
}

/** The quiet caption: what day of it is and what it means. */
export function snowCaption(stage: Stage): string {
  if (stage.city === "mpls") {
    if (stage.day === 1) {
      return stage.before
        ? "Minneapolis snow emergency declared: starting 9 PM, no parking on either side of snow emergency routes until they're plowed."
        : "Minneapolis snow emergency, day 1: no parking on either side of snow emergency routes until they're plowed.";
    }
    if (stage.day === 2) return "Minneapolis snow emergency, day 2: no parking on the even side of non-snow-emergency routes, or on parkways, 8 AM to 8 PM.";
    if (stage.before) return "Minneapolis snow emergency: day 2 is over. Overnight, move cars off the odd side of non-snow-emergency routes; day 3 rules start at 8 AM.";
    return "Minneapolis snow emergency, day 3: no parking on the odd side of non-snow-emergency routes, 8 AM to 8 PM.";
  }
  if (stage.phase === "night") {
    return stage.before
      ? "Saint Paul snow emergency declared: starting 9 PM, no parking on night plow routes or anywhere downtown."
      : "Saint Paul snow emergency, night plow: no parking on night plow routes or anywhere downtown, 9 PM to 7 AM.";
  }
  if (stage.phase === "day") return "Saint Paul snow emergency, day plow: no parking on streets without night plow route signs until they're plowed to the curb, 8 AM to 5 PM.";
  return "Saint Paul snow emergency, cleanup: don't park where the street isn't plowed to the curb yet.";
}

/** Hovering a lit route: the plain rule for that street today. */
export function routeRule(stage: Stage, name?: string): { title: string; detail: string; meta: string } {
  if (stage.city === "mpls") {
    const title = name ? `${name}: snow emergency route.` : "Snow emergency route.";
    const meta = `Minneapolis snow emergency · day ${stage.day}`;
    if (stage.day === 1) {
      return {
        title, meta,
        detail: stage.before
          ? "From 9 PM tonight, no parking on either side until it's fully plowed. Plows clear these streets first."
          : "No parking on either side until it's fully plowed. Plows clear these streets first.",
      };
    }
    if (stage.before) {
      return { title, meta: "Minneapolis snow emergency · before day 3", detail: "Parking is allowed on both sides. Overnight, cars move off the odd side of other streets before day 3 rules start at 8 AM." };
    }
    return {
      title, meta,
      detail: `Parking is allowed on both sides today. Elsewhere, day ${stage.day} rules keep the ${stage.day === 2 ? "even" : "odd"} side of other streets clear, 8 AM to 8 PM.`,
    };
  }
  const meta = `Saint Paul snow emergency · ${stage.phase === "night" ? "night plow" : stage.phase === "day" ? "day plow" : "cleanup"}`;
  const title = "Night plow route.";
  if (stage.phase === "night") {
    return {
      title, meta,
      detail: stage.before
        ? "From 9 PM tonight, no parking on this side of the street. Plows clear it overnight, 9 PM to 7 AM."
        : "No parking on this side of the street. Plows clear it overnight, 9 PM to 7 AM.",
    };
  }
  if (stage.phase === "day") {
    return { title, meta, detail: "Parking is allowed here again. Today plows clear the streets without night plow signs, 8 AM to 5 PM." };
  }
  return { title, meta, detail: "Parking is allowed here where the street is plowed to the curb." };
}

/**
 * `?snow=mpls-2`, `?snow=stp-night` (or `mpls-1`, `mpls-3`, `stp-day`,
 * `stp-cleanup`; `mpls-declared` / `stp-declared` for "starts at 9 PM",
 * `mpls-overnight` for the night before day 3) previews a declared
 * emergency without waiting for winter.
 */
export function previewSnow(spec: string): Stage | undefined {
  const m = /^(mpls|stp)-(0|1|2|3|night|day|cleanup|declared|overnight)$/.exec(spec.trim().toLowerCase());
  if (!m) return undefined;
  if (m[1] === "mpls") {
    if (m[2] === "0" || m[2] === "declared") return { city: "mpls", day: 1, before: true };
    if (m[2] === "overnight") return { city: "mpls", day: 3, before: true };
    return /^[123]$/.test(m[2]) ? { city: "mpls", day: Number(m[2]) as MplsDay } : undefined;
  }
  if (m[2] === "declared") return { city: "stp", phase: "night", before: true };
  return ["night", "day", "cleanup"].includes(m[2]) ? { city: "stp", phase: m[2] as StpPhase } : undefined;
}
