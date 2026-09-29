/**
 * Paces the map's per-frame work to what the device can actually carry.
 *
 * Everything here glides slowly (a bus covers a fraction of a pixel per
 * frame), so an idle screen looks identical at 30 fps but costs half the
 * CPU, GPU and battery. While someone is touching the map it runs at the
 * display's rate, and on a device that can't keep up it steps down further
 * (30 → 20 → 15 fps) instead of stuttering, then probes back up later.
 */

/** Minimum milliseconds between frames at each level: 60, 30, 20, 15 fps. */
const PERIODS_MS = [0, 33.3, 50, 66.7];
/** Idle screens start at level 1 (30 fps). */
const IDLE_LEVEL = 1;
/** How long after the last touch, wheel or key the map counts as being used. */
const ACTIVE_MS = 2500;
/** A frame period this far over the target, sustained, means the device is struggling. */
const OVERLOAD = 1.35;
const OVERLOAD_FRAMES = 30;
/** After stepping down, wait this long before trying a faster level. */
const PROBE_MS = 20_000;
const MAX_PROBE_MS = 5 * 60_000;

export class FrameGovernor {
  /** Levels the device has been pushed down by overload (0 = not overloaded). */
  private overload = 0;
  private lastRun = -Infinity;
  private lastInput = -Infinity;
  private periodEma = 0;
  private slow = 0;
  private nextProbe = Infinity;
  private probeMs = PROBE_MS;

  /** Call on any real input. */
  poke(nowMs: number) { this.lastInput = nowMs; }

  get level(): number { return this.levelAt(this.lastRun); }

  private levelAt(nowMs: number): number {
    const base = nowMs - this.lastInput < ACTIVE_MS ? 0 : IDLE_LEVEL;
    return Math.min(PERIODS_MS.length - 1, base + this.overload);
  }

  /** Whether this animation frame should do the full update. */
  shouldRun(nowMs: number): boolean {
    // Half a millisecond of slack: rAF timestamps jitter around the vsync.
    return nowMs - this.lastRun >= PERIODS_MS[this.levelAt(nowMs)] - 0.5;
  }

  /** Record that a full frame ran at `nowMs`; adapts the level. */
  ran(nowMs: number) {
    const period = nowMs - this.lastRun;
    this.lastRun = nowMs;
    // The first frame, and frames after a stall (hidden tab), say nothing.
    if (!Number.isFinite(period) || period > 500) { this.slow = 0; return; }
    this.periodEma = this.periodEma ? this.periodEma * 0.9 + period * 0.1 : period;

    const level = this.levelAt(nowMs);
    // A display's own refresh (16.7 ms) is the floor for the top level.
    const target = Math.max(PERIODS_MS[level], 1000 / 60);
    if (this.periodEma > target * OVERLOAD && level < PERIODS_MS.length - 1) {
      if (++this.slow >= OVERLOAD_FRAMES) {
        this.overload++;
        this.slow = 0;
        this.periodEma = 0;
        // Each time a probe fails, wait longer before the next.
        this.nextProbe = nowMs + this.probeMs;
        this.probeMs = Math.min(MAX_PROBE_MS, this.probeMs * 2);
      }
    } else {
      this.slow = 0;
    }
    if (this.overload > 0 && nowMs >= this.nextProbe) {
      this.overload--;
      this.periodEma = 0;
      this.nextProbe = this.overload > 0 ? nowMs + this.probeMs : Infinity;
    }
  }
}
