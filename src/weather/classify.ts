/**
 * Turns a National Weather Service observation into what the map shows:
 * a plain summary for the status line and the ingredients for effects.
 */

export type Precip = "none" | "rain" | "snow" | "mix";
export type Intensity = "light" | "moderate" | "heavy";

export interface Weather {
  /** POSIX seconds of the observation. */
  t: number;
  /** e.g. "61°F, light rain" */
  summary: string;
  tempF: number | null;
  precip: Precip;
  intensity: Intensity;
  thunder: boolean;
  /** 0 (clear) to 1 (overcast). */
  cloudCover: number;
  /** Miles; null when unknown. */
  visibilityMi: number | null;
  /** Direction the wind blows toward, degrees clockwise from north. */
  windToward: number;
  windMph: number;
}

interface Measure { value: number | null }
export interface NwsObservation {
  timestamp?: string;
  textDescription?: string;
  temperature?: Measure;
  windSpeed?: Measure;
  windDirection?: Measure;
  visibility?: Measure;
  presentWeather?: { intensity?: string | null; weather?: string | null; rawString?: string }[];
  cloudLayers?: { amount?: string }[];
}

const COVER: Record<string, number> = { SKC: 0, CLR: 0, FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1, VV: 1 };

export function classify(obs: NwsObservation): Weather {
  const t = obs.timestamp ? Date.parse(obs.timestamp) / 1000 : Date.now() / 1000;
  const c = obs.temperature?.value;
  const tempF = typeof c === "number" ? Math.round(c * 9 / 5 + 32) : null;
  const kmh = obs.windSpeed?.value;
  const windMph = typeof kmh === "number" ? Math.round(kmh * 0.621371) : 0;
  const from = obs.windDirection?.value;
  const windToward = typeof from === "number" ? (from + 180) % 360 : 90; // calm: drift gently east
  const m = obs.visibility?.value;
  const visibilityMi = typeof m === "number" ? Math.round((m / 1609.34) * 10) / 10 : null;
  const cloudCover = Math.max(0, ...(obs.cloudLayers ?? []).map((l) => COVER[l.amount ?? ""] ?? 0));

  const present = obs.presentWeather ?? [];
  const kinds = present.map((p) => `${p.weather ?? ""} ${p.rawString ?? ""}`.toLowerCase());
  const text = (obs.textDescription ?? "").toLowerCase();
  const has = (re: RegExp) => kinds.some((k) => re.test(k)) || re.test(text);
  const snow = has(/snow|\bsn\b|ice pellets|\bpl\b|graupel/);
  const rain = has(/rain|drizzle|\bra\b|\bdz\b|shower/);
  const thunder = has(/thunder|\bts/);
  const precip: Precip = snow && rain ? "mix" : snow ? "snow" : rain || thunder ? "rain" : "none";
  const raw = present.map((p) => p.intensity ?? "").join(" ") + " " + text;
  const intensity: Intensity = /heavy|\+/.test(raw) ? "heavy" : /light|-/.test(raw) ? "light" : "moderate";

  const parts: string[] = [];
  if (tempF !== null) parts.push(`${tempF}°F`);
  parts.push(describe(precip, intensity, thunder, cloudCover, visibilityMi, obs.textDescription));
  return { t, summary: parts.join(", "), tempF, precip, intensity, thunder, cloudCover, visibilityMi, windToward, windMph };
}

function describe(p: Precip, i: Intensity, thunder: boolean, cover: number, vis: number | null, text?: string): string {
  if (thunder) return p === "none" ? "thunderstorms nearby" : "thunderstorms";
  if (p !== "none") {
    const word = p === "mix" ? "rain and snow" : p;
    return i === "moderate" ? word : `${i} ${word}`;
  }
  if (vis !== null && vis < 1) return "fog";
  if (vis !== null && vis < 4) return /haze|smoke/i.test(text ?? "") ? "hazy" : "misty";
  if (cover >= 0.9) return "overcast";
  if (cover >= 0.6) return "mostly cloudy";
  if (cover >= 0.3) return "partly cloudy";
  return "clear";
}

/**
 * `?weather=snow`, `?weather=heavy-rain`, `?weather=fog`, `?weather=storm`,
 * `?weather=partly-cloudy`... previews conditions without waiting for them.
 */
export function previewWeather(spec: string): Weather | undefined {
  const s = spec.toLowerCase();
  if (!s) return undefined;
  const intensity: Intensity = s.includes("heavy") ? "heavy" : s.includes("light") ? "light" : "moderate";
  const base = { t: Date.now() / 1000, tempF: 30, intensity, thunder: false, cloudCover: 1, visibilityMi: 10, windToward: 120, windMph: 12 };
  let w: Omit<Weather, "summary">;
  if (s.includes("snow")) w = { ...base, precip: "snow", visibilityMi: intensity === "heavy" ? 0.8 : 3 };
  else if (s.includes("storm")) w = { ...base, tempF: 72, precip: "rain", thunder: true, intensity: "heavy" };
  else if (s.includes("rain")) w = { ...base, tempF: 58, precip: "rain" };
  else if (s.includes("fog")) w = { ...base, tempF: 45, precip: "none", visibilityMi: 0.4 };
  else if (s.includes("partly")) w = { ...base, tempF: 68, precip: "none", cloudCover: 0.45 };
  else if (s.includes("overcast")) w = { ...base, tempF: 50, precip: "none" };
  else w = { ...base, tempF: 70, precip: "none", cloudCover: 0 };
  const summary = `${w.tempF}°F, ${describe(w.precip, w.intensity, w.thunder, w.cloudCover, w.visibilityMi)}`;
  return { ...w, summary };
}
