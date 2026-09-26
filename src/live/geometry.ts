import { M_PER_DEG_LAT, type Shape } from "../transit/data.ts";

export type LonLat = [number, number];

export interface Projection {
  /** Distance along the shape in meters. */
  dist: number;
  /** How far the point is from the shape, in meters. */
  offset: number;
}

/**
 * Project a point onto a shape. With `near`, only segments within
 * [near - back, near + ahead] meters along the shape are searched; that
 * keeps a bus on a loop or an out-and-back street from snapping to the
 * wrong pass. If nothing in the window is within `maxOffset`, the whole
 * shape is searched instead.
 */
export function project(
  shape: Shape,
  p: LonLat,
  near?: { dist: number; back: number; ahead: number; maxOffset: number },
): Projection {
  if (near) {
    const hit = search(shape, p, near.dist - near.back, near.dist + near.ahead);
    if (hit.offset <= near.maxOffset) return hit;
  }
  return search(shape, p, -Infinity, Infinity);
}

function search(shape: Shape, p: LonLat, lo: number, hi: number): Projection {
  const { path, cum } = shape;
  const kx = M_PER_DEG_LAT * Math.cos((p[1] * Math.PI) / 180);
  const px = p[0] * kx, py = p[1] * M_PER_DEG_LAT;
  let best: Projection = { dist: 0, offset: Infinity };
  for (let i = 0; i < path.length - 1; i++) {
    if (cum[i + 1] < lo || cum[i] > hi) continue;
    const ax = path[i][0] * kx, ay = path[i][1] * M_PER_DEG_LAT;
    const bx = path[i + 1][0] * kx, by = path[i + 1][1] * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    const offset = Math.sqrt(ex * ex + ey * ey);
    // Strictly better wins, so ties keep the earliest pass along the shape.
    if (offset < best.offset - 0.01) best = { dist: cum[i] + t * (cum[i + 1] - cum[i]), offset };
  }
  if (path.length === 1 && best.offset === Infinity) best = { dist: 0, offset: 0 };
  return best;
}

/** Index of the segment containing `dist` (binary search on cumulative distance). */
function segmentAt(shape: Shape, dist: number): number {
  const { cum } = shape;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dist) lo = mid; else hi = mid;
  }
  return lo;
}

/** The point `dist` meters along the shape, clamped to its ends. */
export function pointAt(shape: Shape, dist: number): LonLat {
  const { path, cum } = shape;
  if (dist <= 0 || path.length === 1) return [path[0][0], path[0][1]];
  if (dist >= shape.length) { const e = path[path.length - 1]; return [e[0], e[1]]; }
  const i = segmentAt(shape, dist);
  const span = cum[i + 1] - cum[i];
  const t = span > 0 ? (dist - cum[i]) / span : 0;
  const a = path[i], b = path[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Heading in degrees clockwise from north at `dist` along the shape. */
export function headingAt(shape: Shape, dist: number): number {
  const i = Math.min(segmentAt(shape, Math.max(0, Math.min(dist, shape.length))), shape.path.length - 2);
  if (i < 0) return 0;
  return bearing(shape.path[i], shape.path[i + 1]);
}

export function bearing(a: LonLat, b: LonLat): number {
  const kx = Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  const deg = (Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}
