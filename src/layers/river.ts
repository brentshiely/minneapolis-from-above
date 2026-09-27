import { IconLayer, ScatterplotLayer } from "@deck.gl/layers";
import { LOCKS, downstream, type Boat, type Lock } from "../river/river.ts";
import { LOCK_ICON, TOW_ICON, TOWBOAT_ICON } from "../icons.ts";
import { mixRgb, type RGB } from "../color.ts";
import { FINGER } from "./hover.ts";

export interface RiverFrame {
  boats: Boat[];
  version: number;
  daylight: number;
}

const LOCK_LIST: Lock[] = Object.values(LOCKS);

/** Towboats: a lamp-lit cream at night, a deep rust red by day, both clear of the water's blue. */
export const boatColor = (d = 0): RGB => mixRgb([250, 238, 214], [122, 44, 26], d);
/** Locks are fixtures: quiet slate, a step back from the boats. */
const lockColor = (d = 0): RGB => mixRgb([150, 184, 208], [64, 84, 104], d);

/**
 * Each lock gets a small chamber mark along the river. Boats that have
 * locked through lately sit beside it, drifting off and fading; pleasure
 * boats are tiny dots. Invisible pick discs make both easy to hover.
 */
export function riverLayers(f: RiverFrame) {
  const d = f.daylight;
  const ink = boatColor(d);
  const tows = f.boats.filter((b) => !b.p.rec);
  const rec = f.boats.filter((b) => b.p.rec);
  return [
    new IconLayer<Lock>({
      id: "river-locks",
      data: LOCK_LIST,
      getIcon: () => LOCK_ICON,
      getPosition: (l) => l.at,
      getAngle: (l) => -downstream(l),
      getSize: 20,
      sizeUnits: "pixels",
      billboard: false,
      getColor: [...lockColor(d), 230],
      parameters: { depthCompare: "always" },
      updateTriggers: { getColor: d },
    }),
    new ScatterplotLayer<Boat>({
      id: "river-rec",
      data: rec,
      getPosition: (b) => b.position,
      getFillColor: (b) => [...ink, Math.round(170 * b.alpha)],
      getRadius: 2.5,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getFillColor: [f.version, d] },
    }),
    new IconLayer<Boat>({
      id: "river-boats",
      data: tows,
      getIcon: (b) => (b.p.barges > 0 ? TOW_ICON : TOWBOAT_ICON),
      getPosition: (b) => b.position,
      getAngle: (b) => -b.heading,
      getSize: (b) => (b.p.barges > 0 ? 26 : 20),
      sizeUnits: "pixels",
      billboard: false,
      getColor: (b) => [...ink, Math.round(255 * b.alpha)],
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version, getAngle: f.version, getColor: [f.version, d] },
    }),
    new ScatterplotLayer<Lock>({
      id: "pick-locks",
      data: LOCK_LIST,
      pickable: true,
      getPosition: (l) => l.at,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 14 * FINGER,
      parameters: { depthCompare: "always" },
    }),
    // Boats sit above their locks, so a boat still at the lock wins the hover;
    // towboats come last, so they win over pleasure boats beside them.
    new ScatterplotLayer<Boat>({
      id: "pick-boats",
      data: [...rec, ...tows].filter((b) => b.alpha > 0.3),
      pickable: true,
      getPosition: (b) => b.position,
      getFillColor: [0, 0, 0, 1],
      getRadius: 1,
      radiusUnits: "pixels",
      radiusMinPixels: 11 * FINGER,
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: f.version },
    }),
  ];
}

/** A soft ring around the hovered boat or lock. */
export function riverHighlight(at: [number, number], d = 0) {
  const ring = boatColor(d);
  return [
    new ScatterplotLayer<[number, number]>({
      id: "hover-river",
      data: [at],
      getPosition: (x) => x,
      getFillColor: [...ring, 22],
      getLineColor: [...ring, 170],
      stroked: true,
      lineWidthUnits: "pixels",
      getLineWidth: 1.3,
      getRadius: 17,
      radiusUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getPosition: at.join(), getFillColor: d, getLineColor: d },
    }),
  ];
}
