import { test } from "node:test";
import assert from "node:assert/strict";
import { fillGaps, MAX_FILL_M } from "../src/traffic/gaps.ts";
import type { Freeways } from "../src/traffic/freeways.ts";
import type { Readings } from "../src/traffic/traffic.ts";

const M_PER_DEG_LON = 111_320 * Math.cos((44.9 * Math.PI) / 180);

/** Stretches laid end to end along one east-west road, `lenM` meters each. */
function road(stations: string[], lenM = 500, corridor = (_: number) => 0): Freeways {
  return {
    stations: {},
    stretches: stations.map((station, i) => ({
      corridor: corridor(i),
      station,
      path: [[-93.3 + (i * lenM) / M_PER_DEG_LON, 44.9], [-93.3 + ((i + 1) * lenM) / M_PER_DEG_LON, 44.9]] as [number, number][],
    })),
  };
}

test("a hole between two reporting stretches takes a speed between theirs and is marked estimated", () => {
  const raw: Readings = { A: [60, 1000], B: [null, null], C: [40, 1400] };
  const { readings, estimated } = fillGaps(road(["A", "B", "C"]), raw);
  assert.ok(readings.B[0]! > 40 && readings.B[0]! < 60);
  assert.ok(readings.B[1]! > 1000 && readings.B[1]! < 1400);
  assert.ok(estimated.has("B"));
  assert.ok(!estimated.has("A") && !estimated.has("C"));
  assert.deepEqual(readings.A, [60, 1000]);
});

test("a hole nearer one neighbor leans toward it", () => {
  // A B C D: B is a hole; A is adjacent, D is three stretches away.
  const raw: Readings = { A: [70, 1000], B: [null, null], C: [null, null], D: [20, 1000] };
  const { readings } = fillGaps(road(["A", "B", "C", "D"]), raw);
  assert.ok(readings.B[0]! > readings.C[0]!, "B is closer to the fast neighbor than C is");
  assert.ok(readings.B[0]! > 45, "B sits nearer A's 70 than D's 20");
});

test("a hole at the end of a road borrows from its one neighbor", () => {
  const { readings, estimated } = fillGaps(road(["A", "B"]), { A: [55, 900], B: [null, null] });
  assert.equal(readings.B[0], 55);
  assert.ok(estimated.has("B"));
});

test("a hole too far from any reporting stretch stays blank, while ones within reach are filled", () => {
  const holes = 2 * Math.ceil(MAX_FILL_M / 500) + 2;
  const stations = ["A", ...Array.from({ length: holes }, (_, i) => `H${i}`), "Z"];
  const { readings, estimated } = fillGaps(road(stations), { A: [60, 1000], Z: [60, 1000] });
  assert.equal(readings[`H${Math.floor(holes / 2)}`], undefined, "the middle of a long hole has no sensor within reach");
  assert.ok(estimated.has("H0"), "the first hole is next to A");
  assert.ok(estimated.has(`H${holes - 1}`), "the last hole is next to Z");
});

test("neighbors on a different road are not borrowed from", () => {
  const raw: Readings = { A: [60, 1000], B: [null, null], C: [30, 1000] };
  const { readings } = fillGaps(road(["A", "B", "C"], 500, (i) => (i === 2 ? 1 : 0)), raw);
  assert.equal(readings.B[0], 60); // only A, on its own road
});

test("a stretch with a real speed but no flow gets a flow estimate without being marked estimated", () => {
  const { readings, estimated } = fillGaps(road(["A", "B", "C"]), { A: [60, 1000], B: [58, null], C: [60, 1200] });
  assert.equal(readings.B[0], 58);
  assert.ok(readings.B[1]! >= 1000 && readings.B[1]! <= 1200);
  assert.ok(!estimated.has("B"));
});

test("estimates never feed on other estimates", () => {
  const raw: Readings = { A: [60, 1000], B: [null, null], C: [null, null] };
  const { readings } = fillGaps(road(["A", "B", "C"]), raw);
  assert.equal(readings.B[0], 60);
  assert.equal(readings.C[0], 60); // from A directly, not via B
});

test("with every reading present nothing changes", () => {
  const raw: Readings = { A: [60, 1000], B: [50, 900] };
  const { readings, estimated } = fillGaps(road(["A", "B"]), raw);
  assert.deepEqual(readings, raw);
  assert.equal(estimated.size, 0);
});
