import { daylight, sunPosition, type SunPosition } from "./sun.ts";

/**
 * The time the sky shows. Normally now; `?at=HH:MM` (Minneapolis time,
 * today) starts the clock at another hour, for previewing day and night.
 */
export function skyClock(search = location.search): () => Date {
  const at = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(search).get("at") ?? "");
  if (!at) return () => new Date();
  const start = minneapolisToday(Number(at[1]), Number(at[2]));
  const t0 = Date.now();
  return () => new Date(start.getTime() + (Date.now() - t0));
}

/** Today's date in Minneapolis at the given local hour and minute. */
function minneapolisToday(h: number, m: number): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "shortOffset" })
      .formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const offset = /GMT([+-]\d+)/.exec(parts.timeZoneName ?? "")?.[1] ?? "-6";
  const sign = offset.startsWith("-") ? "-" : "+";
  const hh = String(Math.abs(Number(offset))).padStart(2, "0");
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00${sign}${hh}:00`);
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
