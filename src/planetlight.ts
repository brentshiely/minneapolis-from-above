import { PLANET_NAMES, describePlanet, planetsAt, type Planet, type PlanetName } from "./planets.ts";
import type { Description } from "./describe.ts";

/**
 * The planets at night: same idea as the moon's glow (moonlight.ts), but
 * smaller and quieter — a faint point of light at the edge of the map in
 * each visible planet's compass direction. Venus and Jupiter are usually
 * unmistakable when they're up; Mercury, Mars and Saturn only show once
 * they're reasonably bright and well clear of the horizon. Plain DOM
 * layers, restyled only when something visibly changes.
 */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Hovering this close to a planet's glow counts as hovering it. */
const HIT_RADIUS = 26;

/** Roughly Venus at its brightest, and the faintest we bother showing. */
const BRIGHT_MAG = -4.5;
const DIM_MAG = 1.8;

/** A gentle tint per planet — decoration, not a claim about true color. */
const TINT: Record<PlanetName, [number, number, number]> = {
  Mercury: [214, 214, 222],
  Venus: [255, 248, 230],
  Mars: [255, 158, 130],
  Jupiter: [255, 238, 200],
  Saturn: [230, 214, 178],
};

/** What the hover system needs to know about the planets on screen. */
export interface PlanetsField {
  hit(x: number, y: number): PlanetName | undefined;
  anchor(name: PlanetName): [number, number];
  describe(name: PlanetName): Description | undefined;
}

export class PlanetsGlow implements PlanetsField {
  private divs = new Map<PlanetName, HTMLElement>();
  private planets: Planet[] = [];
  private daylight = 0;
  private centers = new Map<PlanetName, [number, number]>();
  private shown = new Map<PlanetName, number>();
  private lastStyle = new Map<PlanetName, string>();

  constructor(after: HTMLElement) {
    for (const name of PLANET_NAMES) {
      const el = document.createElement("div");
      el.id = `planet-glow-${name.toLowerCase()}`;
      Object.assign(el.style, { position: "fixed", left: "0", top: "0", pointerEvents: "none", opacity: "0" });
      after.insertAdjacentElement("afterend", el);
      this.divs.set(name, el);
    }
  }

  /** Recompute the planets for the sky clock's time (about once a second is plenty). */
  update(date: Date, daylight: number) {
    this.planets = planetsAt(date);
    this.daylight = daylight;
  }

  /** Place each glow for the map's current rotation. Cheap: styles only write when they change. */
  frame(bearing: number, cloudCover: number) {
    const night = 1 - smooth(0.25, 0.65, this.daylight);
    const clouds = 1 - 0.65 * Math.min(1, cloudCover);
    const w = innerWidth, h = innerHeight;
    for (const p of this.planets) {
      const el = this.divs.get(p.name)!;
      const { elevation, azimuth, magnitude } = p.position;
      const rising = smooth(-2, 3, elevation);
      const prominence = clamp01((DIM_MAG - magnitude) / (DIM_MAG - BRIGHT_MAG));
      const bright = night * rising * clouds * prominence;
      this.shown.set(p.name, bright);

      const height = Math.max(0, Math.sin((Math.max(0, elevation) * Math.PI) / 180));
      const a = ((azimuth - bearing) * Math.PI) / 180;
      const vx = Math.sin(a), vy = -Math.cos(a);
      const inset = 22 + 0.35 * (Math.min(w, h) / 2) * height;
      const reach = Math.min(
        Math.abs(vx) > 1e-6 ? (w / 2 - inset) / Math.abs(vx) : Infinity,
        Math.abs(vy) > 1e-6 ? (h / 2 - inset) / Math.abs(vy) : Infinity,
      );
      const cx = w / 2 + vx * reach, cy = h / 2 + vy * reach;
      this.centers.set(p.name, [cx, cy]);

      const r = Math.round(Math.min(w, h) * 0.05 + 70 * bright);
      const style = [cx, cy, r, bright].map((x) => x.toFixed(2)).join();
      if (style === this.lastStyle.get(p.name)) continue;
      this.lastStyle.set(p.name, style);

      const [red, green, blue] = TINT[p.name];
      el.style.width = el.style.height = `${r * 2}px`;
      el.style.transform = `translate(${(cx - r).toFixed(1)}px, ${(cy - r).toFixed(1)}px)`;
      el.style.background = `radial-gradient(circle, rgba(${red}, ${green}, ${blue}, ${(0.55 * bright).toFixed(3)}) 0%, rgba(${red}, ${green}, ${blue}, ${(0.16 * bright).toFixed(3)}) 35%, rgba(${red}, ${green}, ${blue}, 0) 75%)`;
      el.style.opacity = bright > 0.02 ? "1" : "0";
    }
  }

  /** Is the pointer on a visible planet's glow? */
  hit(x: number, y: number): PlanetName | undefined {
    for (const p of this.planets) {
      const shown = this.shown.get(p.name) ?? 0;
      if (shown <= 0.1) continue;
      const c = this.centers.get(p.name);
      if (c && Math.hypot(x - c[0], y - c[1]) <= HIT_RADIUS) return p.name;
    }
    return undefined;
  }

  anchor(name: PlanetName): [number, number] { return this.centers.get(name) ?? [0, 0]; }

  describe(name: PlanetName): Description | undefined {
    const p = this.planets.find((x) => x.name === name);
    return p && describePlanet(p);
  }
}
