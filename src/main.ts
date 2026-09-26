import "./style.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { createBaseMap } from "./basemap.ts";
import { loadTransit } from "./transit/data.ts";
import { routeLayers } from "./layers/routes.ts";

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

const transitReady = loadTransit();

map.once("load", async () => {
  const transit = await transitReady;
  overlay.setProps({ layers: routeLayers(transit, labelsAnchor()) });
  (window as unknown as { godmode: unknown }).godmode = { map, overlay, transit };
});

(window as unknown as { godmode: unknown }).godmode = { map, overlay };
