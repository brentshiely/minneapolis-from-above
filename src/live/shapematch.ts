import type { Shape, Transit } from "../transit/data.ts";
import { headingAt, project, type LonLat } from "./geometry.ts";
import { OFF_ROUTE_M } from "./motion.ts";

/** Fixes this close to two shapes' lines can't tell them apart by position alone. */
const AMBIGUOUS_M = 15;

const byRoute = new WeakMap<Shape[], Map<string, Shape[]>>();

function shapesOf(transit: Transit, route: string): Shape[] {
  let index = byRoute.get(transit.shapes);
  if (!index) {
    index = new Map();
    for (const s of transit.shapes) (index.get(s.route) ?? index.set(s.route, []).get(s.route)!).push(s);
    byRoute.set(transit.shapes, index);
  }
  return index.get(route) ?? [];
}

/** Smallest angle between two compass bearings, 0-180. */
export const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The route line a vehicle is on when its trip id isn't in the baked
 * schedule (a new feed changes the ids, a bus runs an added or detoured
 * trip). Trip ids drift; the route a bus reports and where it is don't.
 *
 * Among the route's shapes, those the fix lies on are candidates. A bus
 * already on one stays on it (no flip-flopping between the two directions
 * of a street both shapes run down). Otherwise the candidate heading the way
 * the bus is facing wins; with no bearing to go on, only a clearly nearest
 * one does, and a coin flip between directions is left for the next fix.
 */
export function inferShape(
  transit: Transit, routeId: string, fix: LonLat,
  hint: { bearing?: number | null; current?: Shape } = {},
): Shape | undefined {
  const { bearing, current } = hint;
  if (current && current.route === routeId && project(current, fix).offset <= OFF_ROUTE_M) return current;

  const near = shapesOf(transit, routeId)
    .map((shape) => ({ shape, ...project(shape, fix) }))
    .filter((c) => c.offset <= OFF_ROUTE_M);
  if (near.length === 0) return undefined;
  if (near.length === 1) return near[0].shape;

  if (bearing != null) {
    // Facing agreement first; position breaks ties between shapes that run the same way.
    const diff = (c: (typeof near)[number]) => angleBetween(headingAt(c.shape, c.dist), bearing);
    return near.reduce((a, b) => {
      const da = diff(a), db = diff(b);
      return Math.abs(da - db) > 20 ? (da < db ? a : b) : a.offset <= b.offset ? a : b;
    }).shape;
  }
  const sorted = [...near].sort((a, b) => a.offset - b.offset);
  return sorted[1].offset - sorted[0].offset > AMBIGUOUS_M ? sorted[0].shape : undefined;
}
