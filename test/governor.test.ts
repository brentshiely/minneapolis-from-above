import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameGovernor } from "../src/perf/governor.ts";

/** Drives the governor with a display at `hz` whose frames each take `costMs` of the budget. */
function drive(g: FrameGovernor, fromMs: number, seconds: number, hz = 60, hitchMs = 0) {
  const step = 1000 / hz;
  let ran = 0, t = fromMs, extra = 0;
  for (; t < fromMs + seconds * 1000; t += step) {
    if (g.shouldRun(t + extra)) { g.ran(t + extra); ran++; extra += hitchMs; }
  }
  return { ran, end: t };
}

test("an idle screen runs at 30 fps", () => {
  const g = new FrameGovernor();
  const { ran } = drive(g, 0, 10);
  assert.ok(ran > 280 && ran < 320, `ran ${ran}`);
});

test("touching the map runs at the display rate, then settles back", () => {
  const g = new FrameGovernor();
  g.poke(0);
  const busy = drive(g, 0, 2);
  assert.ok(busy.ran > 110, `ran ${busy.ran}`);
  const later = drive(g, busy.end + 5000, 4);
  assert.ok(later.ran < 140, `idle again: ran ${later.ran}`);
});

test("a device that can't keep up steps down instead of stuttering", () => {
  const g = new FrameGovernor();
  g.poke(0);
  // Every frame costs an extra 30 ms: 60 fps is impossible.
  drive(g, 0, 3, 60, 30);
  assert.ok(g.level >= 1, `level ${g.level}`);
});

test("a fast device never leaves its level", () => {
  const g = new FrameGovernor();
  g.poke(0);
  for (let s = 0; s < 20; s++) { g.poke(s * 1000); drive(g, s * 1000, 1); }
  assert.equal(g.level, 0);
});

test("after overload it probes a faster level again", () => {
  const g = new FrameGovernor();
  let t = 0;
  t = drive(g, t, 4, 60, 40).end;
  const stepped = g.level;
  assert.ok(stepped >= 2);
  t = drive(g, t, 30).end; // healthy now
  assert.ok(g.level < stepped, `level ${g.level} < ${stepped}`);
});
