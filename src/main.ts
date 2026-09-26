import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap } from "./basemap.ts";
import { loadTransit } from "./transit/data.ts";
import { routeLayers } from "./layers/routes.ts";
import { vehicleLayers } from "./layers/vehicles.ts";
import { Fleet } from "./live/fleet.ts";
import { startFeed } from "./live/feed.ts";

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
  const routes = routeLayers(transit, labelsAnchor());
  let version = 0;

  const render = () => overlay.setProps({ layers: [...routes, ...vehicleLayers(transit, fleet.list(), version)] });
  render();

  const feed = startFeed((feedTime, rows) => {
    fleet.update(feedTime, rows);
    fleet.prune(feedTime, STALE_S);
    version++;
    render();
  }, (err) => console.warn("Vehicle feed:", err));

  (window as unknown as { godmode: unknown }).godmode = { map, overlay, transit, fleet, feed };
});

(window as unknown as { godmode: unknown }).godmode = { map, overlay };
