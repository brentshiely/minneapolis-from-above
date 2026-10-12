import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeFreight, parseRail, runSpeedMs, slice, trainsPerSecond, TrainFlow, type RailLine } from "../src/rail/rail.ts";
import { buildShape } from "../src/transit/data.ts";

const M_PER_DEG_LON = 111_320 * Math.cos((44.9 * Math.PI) / 180);

/** A line running due east `lengthM` meters. */
function line(trainsPerDay: number, lengthM = 20_000, topSpeedMph = 40): RailLine {
  const path: [number, number][] = [[-93.3, 44.9], [-93.3 + lengthM / M_PER_DEG_LON, 44.9]];
  return { rr: "BNSF", trainsPerDay, topSpeedMph, shape: buildShape("t", "BNSF", path) };
}

test("half a line's trains a day run each way", () => {
  assert.equal(trainsPerSecond(86_400), 0.5);
});

test("freight runs slower than the posted top speed, within sane bounds", () => {
  assert.ok(runSpeedMs(60) < 60 * 0.44704);
  assert.ok(runSpeedMs(5) >= 5, "never crawls to a halt");
  assert.ok(runSpeedMs(200) <= 22, "never faster than a freight train would");
});

test("a line with no reported trains draws none", () => {
  const flow = new TrainFlow([line(0)]);
  for (let i = 0; i < 100; i++) flow.advance(1);
  assert.equal(flow.shapes.length, 0);
});

test("a busy line carries about as many trains as its frequency and speed imply", () => {
  // 48 trains a day: 24 each way, so one every hour per direction.
  const l = line(48, 40_000, 40);
  let total = 0, ticks = 0;
  for (let run = 0; run < 40; run++) {
    const flow = new TrainFlow([l]);
    for (let i = 0; i < 600; i++) { flow.advance(1); if (i % 10 === 0) { total += flow.shapes.length; ticks++; } }
  }
  // Expected on the line at once ~ rate x (length + train length) / speed, both directions (partly-entered trains are drawn too).
  const speed = runSpeedMs(40);
  const expected = 2 * (24 / 86_400) * (40_000 + 1150) / speed;
  assert.ok(Math.abs(total / ticks - expected) < expected * 0.35, `${total / ticks} vs ${expected}`);
});

test("trains are drawn tail to head along their direction of travel", () => {
  const l = line(500, 20_000);
  const flow = new TrainFlow([l]);
  for (let i = 0; i < 60; i++) flow.advance(1);
  assert.ok(flow.shapes.length > 0);
  const east = flow.shapes.filter((s) => s.path[s.path.length - 1][0] > s.path[0][0]).length;
  const west = flow.shapes.filter((s) => s.path[s.path.length - 1][0] < s.path[0][0]).length;
  assert.ok(east > 0 && west > 0, `${east} east, ${west} west`);
});

test("a train never extends past the ends of its line", () => {
  const l = line(500, 5_000);
  const flow = new TrainFlow([l]);
  const [west, east] = [l.shape.path[0][0], l.shape.path[1][0]];
  for (let i = 0; i < 400; i++) {
    flow.advance(1);
    for (const s of flow.shapes) for (const [lon] of s.path) assert.ok(lon >= west - 1e-9 && lon <= east + 1e-9);
  }
});

test("slice returns the path between two distances, bends included", () => {
  const shape = buildShape("b", "x", [[-93, 45], [-92.99, 45], [-92.99, 45.01]]);
  const s = slice(shape, 100, shape.length - 100);
  assert.equal(s.length, 3);
  assert.deepEqual(s[1], [-92.99, 45]);
  assert.deepEqual(slice(shape, 50, 50), []);
});

test("the baked file parses to lines with trains a day", () => {
  const lines = parseRail(JSON.parse(readFileSync(new URL("../public/data/rail.json", import.meta.url), "utf8")));
  assert.ok(lines.length > 100);
  assert.ok(lines.every((l) => l.trainsPerDay > 0 && l.shape.length > 0));
});

test("describeFreight says the train is simulated and gives the line's frequency", () => {
  const d = describeFreight(line(30));
  assert.match(d.title, /BNSF freight train/);
  assert.match(d.detail!, /30 trains a day/);
  assert.match(d.detail!, /15 each way/);
  assert.match(d.detail!, /simulated/);
  assert.equal(describeFreight({ ...line(1), rr: "XYZ" }).title, "A XYZ freight train, more or less.");
});

test("every train has its own id", () => {
  const flow = new TrainFlow([line(500)]);
  for (let i = 0; i < 30; i++) flow.advance(1);
  const ids = flow.shapes.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});
