import { auroraStrength, tonightKp, type AuroraResponse } from "./sky/aurora.ts";

/**
 * A faint green wash toward the map's northern edge, only at night and
 * only when tonight's forecast Kp reaches far enough south to matter at
 * this latitude. No disc, no hover: unlike the moon and planets this
 * isn't a discrete object to point at, just a horizon glow.
 */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class AuroraGlow {
  private glow: HTMLElement;
  private strength = 0;
  private daylight = 0;
  private lastStyle = "";

  constructor(after: HTMLElement) {
    this.glow = document.createElement("div");
    this.glow.id = "aurora-glow";
    Object.assign(this.glow.style, { position: "fixed", left: "0", top: "0", pointerEvents: "none", opacity: "0" });
    after.insertAdjacentElement("afterend", this.glow);
  }

  /** Recompute from a fresh forecast; about once every 10 minutes is plenty. */
  update(body: AuroraResponse, nowS: number) {
    this.strength = auroraStrength(tonightKp(body.kp, nowS));
  }

  setDaylight(d: number) { this.daylight = d; }

  /** Cheap enough for every frame: styles only written when they change. */
  frame(bearing: number) {
    const night = 1 - smooth(0.2, 0.5, this.daylight);
    const shown = this.strength * night;
    if (shown <= 0.01) {
      if (this.glow.style.opacity !== "0") this.glow.style.opacity = "0";
      return;
    }
    // Toward geographic north on screen, adjusted for the map's rotation.
    const w = innerWidth, h = innerHeight;
    const a = (-bearing * Math.PI) / 180;
    const vx = Math.sin(a), vy = -Math.cos(a);
    const reach = Math.min(Math.abs(vx) > 1e-6 ? (w / 2) / Math.abs(vx) : Infinity, Math.abs(vy) > 1e-6 ? (h / 2) / Math.abs(vy) : Infinity);
    const cx = w / 2 + vx * reach, cy = h / 2 + vy * reach;
    // The glow hugs the horizon: wide along the edge, shallow toward the center.
    const turn = Math.atan2(vy, vx) + Math.PI / 2;
    const size = Math.max(w, h) * 1.3;
    const style = [cx, cy, turn, shown, size].map((x) => x.toFixed(2)).join();
    if (style === this.lastStyle) return;
    this.lastStyle = style;

    this.glow.style.width = this.glow.style.height = `${size}px`;
    this.glow.style.transform = `translate(${(cx - size / 2).toFixed(1)}px, ${(cy - size / 2).toFixed(1)}px) rotate(${turn.toFixed(3)}rad)`;
    this.glow.style.background = `radial-gradient(ellipse 50% 16% at center, rgba(90, 230, 150, ${(0.16 * shown).toFixed(3)}) 0%, rgba(80, 220, 160, ${(0.08 * shown).toFixed(3)}) 45%, rgba(80, 220, 160, 0) 75%)`;
    this.glow.style.opacity = "1";
  }
}
