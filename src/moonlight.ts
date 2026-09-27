import { describeMoon, moonAt, type Moon } from "./moon.ts";
import type { SunPosition } from "./sun.ts";
import type { Description } from "./describe.ts";

/**
 * The moon at night: a soft glow at the edge of the map in the moon's
 * compass direction, a small disc showing its real phase, and when it's
 * high and near full, the faintest cool wash of moonlight over the city.
 * Plain DOM layers, restyled only when something visibly changes.
 */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The disc's size on screen, CSS pixels. */
const DISC = 20;
/** The disc's backing canvas, with room around it for its halo. */
const CANVAS = 56;
/** Hovering this close to the disc counts as hovering the moon. */
const HIT_RADIUS = 34;

export class MoonGlow {
  private glow: HTMLElement;
  private disc: HTMLCanvasElement;
  private light: HTMLElement;
  private moon?: Moon;
  private sun?: SunPosition;
  private daylight = 0;
  /** How visible the moon is right now, 0–1 (0 hides it and its hover). */
  private shown = 0;
  private center: [number, number] = [0, 0];
  private lastStyle = "";
  private drawnPhase = "";

  constructor(after: HTMLElement) {
    this.glow = document.createElement("div");
    this.glow.id = "moon-glow";
    this.light = document.createElement("div");
    this.light.id = "moon-light";
    this.disc = document.createElement("canvas");
    this.disc.id = "moon-disc";
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.disc.width = this.disc.height = Math.round(CANVAS * dpr);
    for (const el of [this.light, this.glow, this.disc]) {
      Object.assign(el.style, { position: "fixed", left: "0", top: "0", pointerEvents: "none", opacity: "0" });
    }
    Object.assign(this.light.style, { inset: "0", width: "100%", height: "100%", transition: "opacity 4s ease" });
    Object.assign(this.disc.style, { width: `${CANVAS}px`, height: `${CANVAS}px` });
    after.insertAdjacentElement("afterend", this.disc);
    after.insertAdjacentElement("afterend", this.glow);
    after.insertAdjacentElement("afterend", this.light);
  }

  /** Recompute the moon for the sky clock's time (about once a second is plenty). */
  update(date: Date, sun: SunPosition, daylight: number) {
    this.moon = moonAt(date);
    this.sun = sun;
    this.daylight = daylight;
  }

  /**
   * Place the glow for the map's current rotation. Cheap enough for every
   * frame: styles are only written when they change.
   */
  frame(bearing: number, cloudCover: number) {
    const m = this.moon;
    if (!m || !this.sun) return;
    const { elevation, azimuth } = m.position;
    const k = m.phase.illumination;
    // Night only; it fades in from a little before moonrise.
    const night = 1 - smooth(0.25, 0.65, this.daylight);
    const rising = smooth(-4, 3, elevation);
    const height = Math.max(0, Math.sin((Math.max(0, elevation) * Math.PI) / 180));
    const clouds = 1 - 0.65 * Math.min(1, cloudCover);
    this.shown = night * rising * clouds;
    const bright = this.shown * (0.3 + 0.7 * k) * (0.6 + 0.4 * height);

    // Toward the moon on screen (north up when the map isn't rotated),
    // to the edge of the window; the higher it is, the further in.
    const w = innerWidth, h = innerHeight;
    const a = ((azimuth - bearing) * Math.PI) / 180;
    const vx = Math.sin(a), vy = -Math.cos(a);
    const inset = 26 + 0.4 * (Math.min(w, h) / 2) * height;
    const reach = Math.min(Math.abs(vx) > 1e-6 ? (w / 2 - inset) / Math.abs(vx) : Infinity, Math.abs(vy) > 1e-6 ? (h / 2 - inset) / Math.abs(vy) : Infinity);
    const cx = w / 2 + vx * reach, cy = h / 2 + vy * reach;
    this.center = [cx, cy];

    // The lit side faces the sun, as it does in the sky.
    const s = ((this.sun.azimuth - bearing) * Math.PI) / 180;
    const tx = Math.sin(s) - vx, ty = -Math.cos(s) - vy;
    const turn = Math.hypot(tx, ty) > 1e-3 ? Math.atan2(ty, tx) : 0;

    const r = Math.round(Math.min(w, h) * 0.3 + 80 * bright);
    const wash = night * smooth(2, 25, elevation) * clouds * Math.max(0, (k - 0.55) / 0.45) ** 2;
    const style = [cx, cy, r, bright, turn, wash].map((x) => x.toFixed(2)).join();
    if (style === this.lastStyle) return;
    this.lastStyle = style;

    this.glow.style.width = this.glow.style.height = `${r * 2}px`;
    this.glow.style.transform = `translate(${(cx - r).toFixed(1)}px, ${(cy - r).toFixed(1)}px)`;
    this.glow.style.background = `radial-gradient(circle, rgba(196, 210, 238, ${(0.2 * bright).toFixed(3)}) 0%, rgba(170, 190, 228, ${(0.08 * bright).toFixed(3)}) 30%, rgba(150, 175, 220, ${(0.025 * bright).toFixed(3)}) 60%, rgba(150, 175, 220, 0) 100%)`;
    this.glow.style.opacity = bright > 0.005 ? "1" : "0";
    this.disc.style.transform = `translate(${(cx - CANVAS / 2).toFixed(1)}px, ${(cy - CANVAS / 2).toFixed(1)}px) rotate(${turn.toFixed(3)}rad)`;
    this.disc.style.opacity = (Math.min(1, this.shown * 1.2) * 0.92).toFixed(3);
    this.light.style.background = "rgb(150, 175, 225)";
    this.light.style.opacity = (0.045 * wash).toFixed(4);

    const phaseKey = k.toFixed(3);
    if (phaseKey !== this.drawnPhase) { this.drawnPhase = phaseKey; this.drawDisc(k); }
  }

  /** The disc with its real phase, lit side to the right (rotated into place). */
  private drawDisc(k: number) {
    const ctx = this.disc.getContext("2d")!;
    const scale = this.disc.width / CANVAS;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, CANVAS, CANVAS);
    const c = CANVAS / 2, r = DISC / 2;
    // The unlit part, faintly visible by earthshine.
    ctx.fillStyle = "rgba(170, 185, 210, 0.13)";
    ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill();
    // The lit part: the bright limb, then back along the terminator.
    const t = 1 - 2 * k;
    ctx.shadowColor = "rgba(210, 222, 245, 0.8)";
    ctx.shadowBlur = 10 * k;
    ctx.fillStyle = "rgb(236, 240, 246)";
    ctx.beginPath();
    ctx.arc(c, c, r, -Math.PI / 2, Math.PI / 2);
    ctx.ellipse(c, c, Math.abs(t) * r, r, 0, Math.PI / 2, (3 * Math.PI) / 2, t > 0);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /** Is the pointer on the moon? */
  hit(x: number, y: number): boolean {
    return this.shown > 0.15 && Math.hypot(x - this.center[0], y - this.center[1]) <= HIT_RADIUS;
  }

  /** Where the tooltip points, in screen pixels. */
  anchor(): [number, number] { return this.center; }

  describe(): Description | undefined { return this.moon && describeMoon(this.moon); }
}
