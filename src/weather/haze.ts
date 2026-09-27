import { hazeColor, hazeFor, type Air } from "./air.ts";

/**
 * Smoke or ozone haze over the map: a still CSS layer, a little thicker
 * toward the top of the screen, where the view looks farthest away.
 */
export class AirHaze {
  private el: HTMLElement;
  private air?: Air;
  private daylight = 0;

  constructor(el: HTMLElement) {
    this.el = el;
  }

  get current() { return this.air; }

  set(air: Air) {
    this.air = air;
    this.paint();
  }

  setDaylight(d: number) {
    if (Math.abs(d - this.daylight) < 0.01) return;
    this.daylight = d;
    this.paint();
  }

  private paint() {
    const c = hazeColor(this.air?.pollutant, this.daylight);
    // Opacity carries the strength, so changes fade in via CSS.
    this.el.style.background = `linear-gradient(to bottom, ${c}, ${c}b0)`;
    this.el.style.opacity = hazeFor(this.air).toFixed(3);
  }
}
