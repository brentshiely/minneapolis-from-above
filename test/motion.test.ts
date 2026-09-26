import { test } from "node:test";
import assert from "node:assert/strict";
import { buildShape, distM, M_PER_DEG_LAT } from "../src/transit/data.ts";
import { headingAt, pointAt, project, type LonLat } from "../src/live/geometry.ts";
import { Motion, OFF_ROUTE_M } from "../src/live/motion.ts";

const ORIGIN: LonLat = [-93.27, 44.97];
const KX = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180);
/** Point `e` meters east and `n` meters north of the origin. */
const at = (e: number, n: number): LonLat => [ORIGIN[0] + e / KX, ORIGIN[1] + n / M_PER_DEG_LAT];

// An L: 1 km east, then 1 km north. The corner is at 1000 m.
const L = buildShape("L", "r", [at(0, 0), at(1000, 0), at(1000, 1000)]);
// Out and back on the same street: 1 km east, then return west.
const OUT_BACK = buildShape("ob", "r", [at(0, 0), at(1000, 0), at(0, 5)]);

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b}±${tol}, got ${a}`);

test("shape length and point lookup", () => {
  near(L.length, 2000, 2);
  near(distM(pointAt(L, 500), at(500, 0)), 0, 0.5);
  near(distM(pointAt(L, 1500), at(1000, 500)), 0, 0.5);
  near(distM(pointAt(L, -50), at(0, 0)), 0, 0.01, "clamps before start");
  near(distM(pointAt(L, 9999), at(1000, 1000)), 0, 0.01, "clamps past end");
  near(headingAt(L, 500), 90, 1);
  near(headingAt(L, 1500), 0, 1);
});

test("projection snaps a noisy GPS fix onto the route", () => {
  const p = project(L, at(400, 12));
  near(p.dist, 400, 1);
  near(p.offset, 12, 0.5);
});

test("projection near a hint picks the right pass of an out-and-back", () => {
  // Point at 300 m east: the outbound pass is at 300 m, the return at ~1700 m.
  const outbound = project(OUT_BACK, at(300, 2), { dist: 250, back: 300, ahead: 400, maxOffset: 50 });
  near(outbound.dist, 300, 5);
  const inbound = project(OUT_BACK, at(300, 3), { dist: 1600, back: 300, ahead: 400, maxOffset: 50 });
  near(inbound.dist, 1700, 5);
});

test("glides along the shape and rounds the corner instead of cutting it", () => {
  const m = new Motion(L, at(900, 0), 1000);
  m.onFix(L, at(1000, 100), 1015); // 200 m further, just past the corner
  const path: LonLat[] = [];
  for (let i = 0; i < 15 * 10; i++) { m.advance(0.1); path.push(m.pos); }
  near(distM(m.pos, at(1000, 100)), 0, 1, "arrives at the fix");
  // Every drawn point stays on the route; a straight line would pass ~70 m
  // inside the corner.
  for (const p of path) assert.ok(project(L, p).offset < 0.5, "left the route");
  assert.ok(path.some((p) => distM(p, at(1000, 0)) < 5), "passes through the corner");
});

test("arrives in about the time between fixes, at a steady speed", () => {
  const m = new Motion(L, at(100, 0), 1000);
  m.onFix(L, at(400, 0), 1020); // 300 m over 20 s
  m.advance(10);
  near(m.dist, 250, 1, "halfway at half time");
  m.advance(10);
  near(m.dist, 400, 1);
  m.advance(10);
  near(m.dist, 400, 0.01, "stops at the fix, doesn't overshoot");
});

test("never runs backwards on a fix behind the drawn position", () => {
  const m = new Motion(L, at(100, 0), 1000);
  m.onFix(L, at(500, 0), 1015);
  m.advance(15);
  near(m.dist, 500, 1);
  const before = m.dist;
  m.onFix(L, at(470, 0), 1030); // GPS jitter 30 m behind
  for (let i = 0; i < 100; i++) { m.advance(0.2); assert.ok(m.dist >= before - 1e-9, "moved backwards"); }
  // Next real fix ahead resumes forward motion.
  m.onFix(L, at(650, 0), 1045);
  m.advance(15);
  near(m.dist, 650, 1);
});

test("progress stays monotonic through a noisy sequence of fixes", () => {
  const m = new Motion(L, at(0, 0), 1000);
  const truth = [80, 170, 160, 260, 380, 375, 520, 700, 910, 1090, 1300];
  const jitter = [5, -8, 6, -4, 9, -7, 3, -6, 8, -5, 4];
  let prev = m.dist;
  truth.forEach((d, i) => {
    const p = pointAt(L, d);
    const noisy: LonLat = [p[0] + jitter[i] / KX, p[1] + jitter[i] / M_PER_DEG_LAT];
    m.onFix(L, noisy, 1000 + 15 * (i + 1));
    for (let k = 0; k < 30; k++) {
      m.advance(0.5);
      assert.ok(m.dist >= prev - 1e-9, `backwards at fix ${i}`);
      prev = m.dist;
    }
  });
  near(m.dist, 1300, 15);
});

test("jumps rather than racing when a fix is implausibly far ahead", () => {
  const long = buildShape("long", "r", [at(0, 0), at(8000, 0)]);
  const m = new Motion(long, at(0, 0), 1000);
  m.onFix(long, at(5000, 0), 1015);
  near(m.dist, 5000, 1);
});

test("falls back to a straight line off the route, and rejoins it", () => {
  const m = new Motion(L, at(200, 0), 1000);
  assert.ok(m.onShape);
  m.onFix(L, at(400, OFF_ROUTE_M + 100), 1015); // detour a block north
  assert.equal(m.onShape, false);
  m.advance(15);
  near(distM(m.pos, at(400, OFF_ROUTE_M + 100)), 0, 1);
  m.onFix(L, at(600, 0), 1030); // back on route
  assert.ok(m.onShape);
});

test("vehicles with no shape glide straight to each fix", () => {
  const m = new Motion(undefined, at(0, 0), 1000);
  m.onFix(undefined, at(300, 400), 1015);
  m.advance(7.5);
  near(distM(m.pos, at(150, 200)), 0, 1, "halfway");
  m.advance(10);
  near(distM(m.pos, at(300, 400)), 0, 0.5);
});

test("a repeated fix changes nothing", () => {
  const m = new Motion(L, at(100, 0), 1000);
  m.onFix(L, at(300, 0), 1015);
  const speed = m.speed;
  m.onFix(L, at(300, 0), 1015);
  assert.equal(m.speed, speed);
});
