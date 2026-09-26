import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap } from "./basemap.ts";
import { loadTransit } from "./transit/data.ts";
import { routeLayers } from "./layers/routes.ts";
import { trailLayers, vehicleLayers, type VehicleFrame } from "./layers/vehicles.ts";
import { Fleet } from "./live/fleet.ts";
import { startFeed } from "./live/feed.ts";
import { Trails } from "./live/trails.ts";

const map = createBaseMap(document.getElementById("map")!);
const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
map.addControl(overlay);

/**
 * Route lines sit above roads but beneath street and place names, so labels
 * stay legible. That's the first label after the last road or rail layer;
 * the style's water labels come earlier and would bury routes under roads.
 */
function labelsAnchor(): string | undefined {
  const layers = map.getStyle().layers;
  let lastRoad = -1;
  layers.forEach((l, i) => { if (l.type === "line" && /^(highway|railway|road|aeroway)/.test(l.id)) lastRoad = i; });
  return layers.slice(lastRoad + 1).find((l) => l.type === "symbol")?.id;
}

/** Vehicles not reported for this long are removed from the map. */
const STALE_S = 180;

const transitReady = loadTransit();
const mapReady = new Promise<void>((resolve) => map.once("load", () => resolve()));

Promise.all([transitReady, mapReady]).then(([transit]) => {
  const fleet = new Fleet(transit);
  const trails = new Trails();
  const routes = routeLayers(transit, labelsAnchor());
  const f: VehicleFrame = { vehicles: [], trails: [], now: 0, version: 0, trailsVersion: 0 };

  /** Trail geometry is rebuilt a few times a second; the fade animates every frame. */
  const TRAIL_REBUILD_S = 0.25;
  let lastTrailBuild = -Infinity;

  // Each frame glides every vehicle along its route and redraws.
  let last = performance.now();
  const frame = (nowMs: number) => {
    // Clamp so a long pause (backgrounded tab) doesn't lurch everything at once.
    const dt = Math.min(0.25, (nowMs - last) / 1000);
    last = nowMs;
    const now = nowMs / 1000;
    fleet.advance(dt);
    trails.record(fleet, now);
    if (now - lastTrailBuild >= TRAIL_REBUILD_S) {
      lastTrailBuild = now;
      f.trails = trails.snapshot(now);
      f.trailsVersion++;
    }
    f.vehicles = fleet.list();
    f.now = now;
    f.version++;
    overlay.setProps({ layers: [...routes, ...trailLayers(transit, f), ...vehicleLayers(transit, f)] });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const feed = startFeed((feedTime, rows) => {
    fleet.update(feedTime, rows);
    fleet.prune(feedTime, STALE_S);
  }, (err) => console.warn("Vehicle feed:", err));

  (window as unknown as { godmode: unknown }).godmode = { map, overlay, transit, fleet, feed, trails };
});

(window as unknown as { godmode: unknown }).godmode = { map, overlay };
