import { daylight, sunPosition, type SunPosition } from "./sun.ts";

/**
 * The time the sky shows. Normally now; `?at=HH:MM` (Minneapolis time,
 * today) starts the clock at another hour, for previewing day and night,
 * and `?date=YYYY-MM-DD` on another day (for previewing the moon's phases).
 */
export function skyClock(search = location.search): () => Date {
  const q = new URLSearchParams(search);
  const at = /^(\d{1,2}):(\d{2})$/.exec(q.get("at") ?? "");
  const day = q.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day)) ? day : undefined;
  if (!at && !date) return () => new Date();
  const now = minneapolisParts(new Date());
  const start = minneapolisTime(date ?? `${now.year}-${now.month}-${now.day}`,
    at ? Number(at[1]) : Number(now.hour), at ? Number(at[2]) : Number(now.minute));
  const t0 = Date.now();
  return () => new Date(start.getTime() + (Date.now() - t0));
}

const minneapolisParts = (d: Date): Record<string, string> => Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "shortOffset",
  }).formatToParts(d).map((p) => [p.type, p.value]),
);

/** A Minneapolis date ("2026-09-26") at the given local hour and minute. */
function minneapolisTime(day: string, h: number, m: number): Date {
  // That day's offset from UTC (daylight time or not), read at its midday.
  const offset = /GMT([+-]\d+)/.exec(minneapolisParts(new Date(`${day}T18:00:00Z`)).timeZoneName ?? "")?.[1] ?? "-6";
  const sign = offset.startsWith("-") ? "-" : "+";
  const hh = String(Math.abs(Number(offset))).padStart(2, "0");
  return new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${sign}${hh}:00`);
}

export interface Sky {
  sun: SunPosition;
  /** 0 (night) to 1 (day). */
  daylight: number;
}

export function skyAt(date: Date): Sky {
  const sun = sunPosition(date);
  return { sun, daylight: daylight(sun.elevation) };
}
