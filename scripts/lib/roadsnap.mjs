// Snaps MnDOT's freeway sensor positions onto OpenStreetMap's highway lines,
// so the traffic lines lie on the same pavement the basemap draws.
//
// MnDOT lists a freeway as sensors every third to half a mile. Joined by
// straight lines they cut every curve and interchange, and a fixed sideways
// nudge to separate the two directions lands outside the road where the
// sensors weren't on the centerline. OSM draws each carriageway as its own
// one-way line, so: put each sensor on the carriageway going its way, then
// follow that carriageway from sensor to sensor.

export const M_PER_DEG = 111_320;

export const dist = (a, b) => {
  const kx = Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  return Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]) * M_PER_DEG;
};

/** Compass bearing from a to b, degrees clockwise from north. */
export const bearing = (a, b) => {
  const kx = Math.cos(((a[1] + b[1]) * Math.PI) / 360);
  return ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
};

/** Smallest angle between two compass bearings, 0-180. */
export const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/** A route's baseline name, without the express-lane / collector-road suffix MnDOT adds ("I-94 CD"). */
const baseRoute = (route) => route.replace(/ (Rev|CD)$/, "");

/** Express lanes and collector roads aren't separate lines in OSM's highway ref, so they aren't snapped. */
export const snappable = (route) => !/ (Rev|CD)$/.test(route);

/**
 * The refs OSM may use for a MnDOT route: "I-94" is "I 94"; "U.S.169" is
 * "US 169"; "T.H.55" is "MN 55" (and "T.H.10", which is US 10 on the map, "US 10").
 */
export function refTokens(route) {
  const r = baseRoute(route);
  let m;
  if ((m = /^I-(\d+\w*)/.exec(r))) return [`I ${m[1]}`];
  if ((m = /^U\.S\.(\d+\w*)/.exec(r))) return [`US ${m[1]}`];
  if ((m = /^T\.H\.(\d+\w*)/.exec(r))) return [`MN ${m[1]}`, `US ${m[1]}`];
  return [];
}

/** Whether an OSM way's `ref` tag ("I 94;US 52") names any of `tokens`. */
export function hasRef(tags, tokens) {
  if (!tags?.ref) return false;
  const refs = tags.ref.split(/[;,]/).map((s) => s.trim().replace(/^([A-Z]+)-(?=\d)/i, "$1 ").replace(/\s+/g, " ").toUpperCase());
  return tokens.some((t) => refs.includes(t.toUpperCase()));
}

/** 1 for a way drawn in its travel direction, -1 for reversed, 0 for two-way. */
export function onewayOf(tags) {
  const o = tags.oneway;
  if (o === "yes" || o === "true" || o === "1") return 1;
  if (o === "-1" || o === "reverse") return -1;
  if (o === "no" || o === "false" || o === "0") return 0;
  return tags.highway === "motorway" || tags.junction === "roundabout" ? 1 : 0;
}

const CELL = 0.002; // degrees: about 220 m by 160 m
const cellKey = (x, y) => `${x},${y}`;

/**
 * A directed graph of the ways carrying any of `tokens`. `ways` are Overpass
 * JSON elements from `out geom`: { nodes: [ids], geometry: [{lat, lon}], tags }.
 * Besides the vertices and the edges leaving each, it indexes every edge by
 * the map cells it passes through, so a sensor can find the road beside it.
 */
export function buildGraph(ways, tokens) {
  const vert = new Map(); // node id -> [lon, lat]
  const adj = new Map(); // node id -> [{ to, len, two }]
  const edges = []; // { u, v, two }
  const edge = (a, b, two) => {
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push({ to: b, len: dist(vert.get(a), vert.get(b)), two });
    edges.push({ u: a, v: b, two });
  };
  for (const w of ways) {
    if (!hasRef(w.tags, tokens) || !w.nodes || !w.geometry || w.nodes.length !== w.geometry.length) continue;
    w.nodes.forEach((id, i) => vert.set(id, [w.geometry[i].lon, w.geometry[i].lat]));
    const dir = onewayOf(w.tags);
    for (let i = 0; i < w.nodes.length - 1; i++) {
      const a = w.nodes[i], b = w.nodes[i + 1];
      if (a === b) continue;
      if (dir === 1) edge(a, b, false);
      else if (dir === -1) edge(b, a, false);
      else { edge(a, b, true); edge(b, a, true); }
    }
  }
  const index = new Map();
  for (const e of edges) {
    const a = vert.get(e.u), b = vert.get(e.v);
    const steps = Math.max(1, Math.ceil(dist(a, b) / 40));
    const seen = new Set();
    for (let k = 0; k <= steps; k++) {
      const key = cellKey(Math.floor((a[0] + ((b[0] - a[0]) * k) / steps) / CELL), Math.floor((a[1] + ((b[1] - a[1]) * k) / steps) / CELL));
      if (seen.has(key)) continue;
      seen.add(key);
      (index.get(key) ?? index.set(key, []).get(key)).push(e);
    }
  }
  return { vert, adj, index };
}

/** Where `p` falls on the segment a-b: the nearest point, how far along (0-1), and how far away in meters. */
function project(p, a, b) {
  const kx = Math.cos((p[1] * Math.PI) / 180) * M_PER_DEG;
  const ax = a[0] * kx, ay = a[1] * M_PER_DEG, dx = b[0] * kx - ax, dy = b[1] * M_PER_DEG - ay;
  const px = p[0] * kx - ax, py = p[1] * M_PER_DEG - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], t, offset: Math.hypot(px - t * dx, py - t * dy) };
}

/**
 * The spot on the road a sensor belongs on: the nearest point of a segment
 * within `maxM` that runs the sensor's way. Of two carriageways side by side,
 * only one is going the sensor's way. Returns { edge, t, point, offset }.
 */
export function snapNode(graph, p, travelBearing, maxM = 70, maxTurn = 75) {
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  let best, bestScore = Infinity;
  const seen = new Set();
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (const e of graph.index.get(cellKey(x, y)) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        const a = graph.vert.get(e.u), b = graph.vert.get(e.v);
        const turn = angleBetween(bearing(a, b), travelBearing);
        if (turn > maxTurn) continue;
        const hit = project(p, a, b);
        if (hit.offset > maxM) continue;
        const score = hit.offset + turn * 0.6;
        if (score < bestScore) { bestScore = score; best = { edge: e, ...hit }; }
      }
    }
  }
  return best;
}

/** A binary min-heap on `.d`. */
class Heap {
  items = [];
  push(item) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p].d <= a[i].d) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].d < a[m].d) m = l;
        if (r < a.length && a[r].d < a[m].d) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.items.length; }
}

/** Shortest way along the directed graph, or undefined if it's longer than `maxLen` (counting `startD` already spent). Returns { ids, two }. */
export function route(graph, from, to, maxLen, startD = 0) {
  if (from === to) return { ids: [from], two: false };
  const best = new Map([[from, startD]]);
  const prev = new Map();
  const heap = new Heap();
  heap.push({ id: from, d: startD });
  while (heap.size) {
    const { id, d } = heap.pop();
    if (d > (best.get(id) ?? Infinity)) continue;
    if (id === to) {
      const ids = [to];
      let two = false;
      for (let cur = to; cur !== from;) { const p = prev.get(cur); two ||= p.two; cur = p.from; ids.push(cur); }
      return { ids: ids.reverse(), two };
    }
    for (const e of graph.adj.get(id) ?? []) {
      const nd = d + e.len;
      if (nd > maxLen || nd >= (best.get(e.to) ?? Infinity)) continue;
      best.set(e.to, nd);
      prev.set(e.to, { from: id, two: e.two });
      heap.push({ id: e.to, d: nd });
    }
  }
  return undefined;
}

/**
 * Follow the road from each sensor to the next. Returns one entry per pair of
 * consecutive `nodes` ({ p: [lon, lat] }): the path along the road
 * (`snapped`), or just the two sensor positions where the road couldn't be
 * followed. `twoWay` is set where the road is a single line for both directions.
 */
export function snapRun(graph, nodes, { maxSnapM = 70, detour = 1.8, slackM = 250 } = {}) {
  const travel = nodes.map((n, i) => bearing(nodes[Math.max(0, i - 1)].p, nodes[Math.min(nodes.length - 1, i + 1)].p));
  const snaps = nodes.map((n, i) => snapNode(graph, n.p, travel[i], maxSnapM));
  const out = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const A = snaps[i], B = snaps[i + 1];
    const maxLen = dist(nodes[i].p, nodes[i + 1].p) * detour + slackM;
    let path, two;
    if (A && B) {
      if (A.edge === B.edge && B.t >= A.t) {
        // Both sensors on the same piece of road.
        path = [A.point, B.point];
        two = A.edge.two;
      } else {
        const start = dist(A.point, graph.vert.get(A.edge.v));
        const hit = route(graph, A.edge.v, B.edge.u, maxLen - dist(graph.vert.get(B.edge.u), B.point), start);
        if (hit) {
          path = [A.point, ...hit.ids.map((id) => graph.vert.get(id)), B.point];
          two = hit.two || A.edge.two || B.edge.two;
        }
      }
    }
    out.push(path ? { path, snapped: true, twoWay: two } : { path: [nodes[i].p, nodes[i + 1].p], snapped: false, twoWay: false });
  }
  return out;
}

/** Douglas-Peucker: drop vertices that sit within `tolM` meters of the line between their neighbors. */
export function simplify(path, tolM) {
  if (path.length < 3) return path;
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack = [[0, path.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    const a = path[lo], b = path[hi];
    const kx = Math.cos((a[1] * Math.PI) / 180) * M_PER_DEG;
    const ax = a[0] * kx, ay = a[1] * M_PER_DEG, dx = b[0] * kx - ax, dy = b[1] * M_PER_DEG - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1, worstD = tolM;
    for (let i = lo + 1; i < hi; i++) {
      const px = path[i][0] * kx - ax, py = path[i][1] * M_PER_DEG - ay;
      const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const d = Math.hypot(px - t * dx, py - t * dy);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([lo, worst], [worst, hi]); }
  }
  return path.filter((_, i) => keep[i]);
}

/** Shift a polyline `m` meters to the right of its direction of travel. */
export function offsetRight(path, m) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const kx = Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * kx, dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + ((dy / len) * m) / (M_PER_DEG * kx), p[1] + ((-dx / len) * m) / M_PER_DEG];
  });
}
