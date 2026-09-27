import { snowCaption, stageAt, type City, type SnowResponse, type Stage } from "./rules.ts";
import { loadSnowRoutes, type SnowRoute, type SnowRoutes } from "./routes.ts";

const CITIES: City[] = ["mpls", "stp"];

/**
 * Keeps track of declared snow emergencies: which day or phase each city
 * is in, the quiet caption that says so, and which routes to light. With
 * nothing declared it shows nothing and never loads the route data.
 */
export class SnowWatch {
  /** Where each city's emergency stands, if one is declared. */
  stages: Partial<Record<City, Stage>> = {};
  /** The routes to light; a new array only when that changes. */
  lit: SnowRoute[] = [];
  private status?: SnowResponse;
  private key = "";
  private routes?: SnowRoutes | "loading";
  private el: HTMLElement;
  private clock: () => Date;
  private preview?: Stage;

  constructor(el: HTMLElement, clock: () => Date, preview?: Stage) {
    this.el = el; this.clock = clock; this.preview = preview;
    this.refresh();
  }

  /** A fresh answer from /api/snow. */
  update(status: SnowResponse) {
    this.status = status;
    this.refresh();
  }

  /** Recompute where things stand (call every so often: day 2 begins at 8 AM). */
  refresh() {
    const now = this.clock();
    const stages: Partial<Record<City, Stage>> = {};
    for (const city of CITIES) {
      const s = this.preview ? (this.preview.city === city ? this.preview : undefined) : stageAt(city, this.status?.[city], now);
      if (s) stages[city] = s;
    }
    const key = JSON.stringify(stages);
    if (key === this.key) {
      // Try the route data again after a failed load.
      if (!this.routes && this.lit.length === 0 && key !== "{}") this.light();
      return;
    }
    this.key = key;
    this.stages = stages;
    this.render();
    this.light();
  }

  private render() {
    const lines = CITIES.map((c) => this.stages[c]).filter((s): s is Stage => !!s).map((s) => {
      const div = document.createElement("div");
      div.textContent = snowCaption(s);
      return div;
    });
    this.el.replaceChildren(...lines);
    this.el.classList.toggle("shown", lines.length > 0);
  }

  private light() {
    const cities = CITIES.filter((c) => this.stages[c]);
    if (!cities.length) { if (this.lit.length) this.lit = []; return; }
    if (!this.routes) {
      this.routes = "loading";
      loadSnowRoutes()
        .then((r) => { this.routes = r; this.light(); })
        .catch((e) => { this.routes = undefined; console.warn(e); });
    }
    if (this.routes === "loading") return;
    const all = this.routes;
    this.lit = cities.flatMap((c) => all?.[c] ?? []);
  }
}
