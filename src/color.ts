export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const mixNumber = (a: number, b: number, t: number) => a + (b - a) * t;

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(mixNumber(a[0], b[0], t)), Math.round(mixNumber(a[1], b[1], t)), Math.round(mixNumber(a[2], b[2], t))];
}

/** Blend two "#rrggbb" colors; returns "#rrggbb". */
export function mixColor(a: string, b: string, t: number): string {
  const [r, g, bl] = mixRgb(hexToRgb(a), hexToRgb(b), t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** A paint value at night and by day; colors and numbers blend between them. */
export type Pair = [night: string | number, day: string | number];

/** Where the blue hour sits on the way from night (0) to day (1). */
const TWILIGHT_AT = 0.42;

/**
 * Dusk isn't the average of night and day, which is a flat grey; it's
 * blue. The blue-hour color is a darkish blend of the two, tinted blue.
 */
export function twilightOf(night: string, day: string): string {
  const [r, g, b] = hexToRgb(mixColor(night, day, 0.3));
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (c(r * 0.78) << 16) | (c(g * 0.9) << 8) | c(b * 1.18 + 10)).toString(16).slice(1)}`;
}

/** Blend through three stops: night, blue hour, day. */
export function through3(night: string, twilight: string, day: string, d: number): string {
  return d <= TWILIGHT_AT
    ? mixColor(night, twilight, d / TWILIGHT_AT)
    : mixColor(twilight, day, (d - TWILIGHT_AT) / (1 - TWILIGHT_AT));
}

export function blendPair(pair: Pair, d: number): string | number {
  if (typeof pair[0] === "number") return mixNumber(pair[0], pair[1] as number, d);
  const [night, day] = pair as [string, string];
  return through3(night, twilightOf(night, day), day, d);
}

