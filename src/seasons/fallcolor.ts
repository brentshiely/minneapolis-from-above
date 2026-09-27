/**
 * MN DNR's Fall Color Finder, as a warm ambient wash over the map: a
 * quiet CSS layer, the same pattern as the air-quality haze, in season
 * only.
 */
import type { FallColorResponse } from "../../functions/api/fallcolor.ts";

export type { FallColorResponse };

/** DNR's scale runs 1 (no change) to 6 (past peak, mostly bare). */
const MIN_LEAVES = 1, MAX_LEAVES = 6;

/** 0 (green) to 1 (past peak): how strong the tint should read. */
export function fallColorStrength(avgLeaves: number | undefined): number {
  if (avgLeaves === undefined) return 0;
  return Math.max(0, Math.min(1, (avgLeaves - MIN_LEAVES) / (MAX_LEAVES - MIN_LEAVES)));
}

export function fallColorWord(avgLeaves: number): string {
  if (avgLeaves < 2) return "just starting";
  if (avgLeaves < 3.5) return "changing";
  if (avgLeaves < 5) return "near peak";
  return "past peak";
}

/** Quiet unless there's real color to report. */
export function fallColorPhrase(body: FallColorResponse): string | undefined {
  if (body.avgLeaves === undefined || body.avgLeaves < 2) return undefined;
  return `Fall color: ${fallColorWord(body.avgLeaves)}`;
}

const PREVIEW: Record<string, number> = { starting: 1.5, changing: 3, peak: 4.5, past: 5.8 };

/** `?fallcolor=peak` (or starting, changing, past) previews a level year-round. */
export function previewFallColor(spec: string): FallColorResponse | undefined {
  const avgLeaves = PREVIEW[spec.trim().toLowerCase()];
  if (avgLeaves === undefined) return undefined;
  return { t: Math.floor(Date.now() / 1000), avgLeaves, samples: 7 };
}

/** A still warm-orange wash, the same technique as AirHaze: opacity carries the strength. */
export class FallColorHaze {
  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    this.el.style.background = "linear-gradient(to bottom, rgba(190, 110, 40, 0.5), rgba(150, 70, 30, 0.3))";
  }

  set(body: FallColorResponse) {
    this.el.style.opacity = (fallColorStrength(body.avgLeaves) * 0.35).toFixed(3);
  }
}
