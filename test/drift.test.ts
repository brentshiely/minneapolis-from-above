import { test } from "node:test";
import assert from "node:assert/strict";
import { Drift, DWELL_S, TRAVEL_S, type Camera, type DriftMap, type LonLat, type Scene } from "../src/drift.ts";

function fakeMap() {
  const calls: string[] = [];
  let cam: Camera = { center: [-93.18, 44.96], zoom: 10, bearing: 0, pitch: 0 };
  const map: DriftMap & { calls: string[]; cam: () => Camera } = {
    calls,
    cam: () => cam,
    easeTo(o) { calls.push(`ease ${o.center.join(",")} z${o.zoom}`); cam = { center: o.center, zoom: o.zoom, bearing: o.bearing, pitch: o.pitch }; },
    jumpTo(o) { calls.push("jump"); cam = { ...cam, ...o } as Camera; },
    stop() { calls.push("stop"); },
    getCenter: () => ({ lng: cam.center[0], lat: cam.center[1] }),
    getZoom: () => cam.zoom,
    getBearing: () => cam.bearing,
  };
  return map;
}

const A: Scene = { kind: "landmark", name: "Over A", center: [-93.2, 44.9], zoom: 12, bearing: 0, pitch: 20 };
const B: Scene = { kind: "landmark", name: "Over B", center: [-93.1, 44.95], zoom: 13, bearing: 10, pitch: 30 };

test("stays put until the map has been idle long enough", () => {
  const map = fakeMap();
  const d = new Drift(map, [A, B], 0, 90);
  d.tick(89);
  assert.equal(d.drifting, false);
  assert.deepEqual(map.calls, []);
  d.tick(90);
  assert.equal(d.drifting, true);
  assert.deepEqual(map.calls, ["ease -93.2,44.9 z12"]);
});

test("travels, lingers, then moves on to the next view, with captions", () => {
  const map = fakeMap();
  const captions: (string | undefined)[] = [];
  const d = new Drift(map, [A, B], 0, 10);
  d.onCaption = (c) => captions.push(c);
  d.tick(10);
  d.tick(10 + TRAVEL_S);                 // arrived: linger with a slow turn
  assert.match(map.calls.at(-1)!, /^ease -93.2,44.9 z12/);
  assert.equal(map.cam().bearing, 10, "turns slowly while lingering");
  d.tick(10 + TRAVEL_S + DWELL_S);       // next view
  assert.equal(map.calls.at(-1), "ease -93.1,44.95 z13");
  assert.deepEqual(captions, ["Over A", "Over B"]);
});

test("any input stops the tour at once and restarts the idle clock", () => {
  const map = fakeMap();
  const captions: (string | undefined)[] = [];
  const d = new Drift(map, [A, B], 0, 10);
  d.onCaption = (c) => captions.push(c);
  d.tick(10);
  d.wake(15);
  assert.equal(d.drifting, false);
  assert.equal(map.calls.at(-1), "stop");
  assert.equal(captions.at(-1), undefined, "caption cleared");
  d.tick(24);
  assert.equal(d.drifting, false, "idle clock restarted at the input");
  d.tick(25);
  assert.equal(d.drifting, true);
});

test("never drifts while held still (reduced motion or a pinned tooltip)", () => {
  const map = fakeMap();
  const d = new Drift(map, [A], 0, 10);
  let hold = true;
  d.holdStill = () => hold;
  d.tick(100);
  assert.equal(d.drifting, false);
  hold = false;
  d.tick(105);
  assert.equal(d.drifting, false, "holding counts as activity");
  d.tick(110);
  assert.equal(d.drifting, true);
});

test("follows a moving subject, and skips the scene when there's nothing to follow", () => {
  const map = fakeMap();
  let pos: LonLat | undefined = [-93.25, 44.97];
  let available = false;
  const follow: Scene = {
    kind: "follow", zoom: 14, pitch: 40,
    find: () => (available ? { name: "Riding along", position: () => pos } : undefined),
  };
  const captions: (string | undefined)[] = [];
  const d = new Drift(map, [follow, A], 0, 1);
  d.onCaption = (c) => captions.push(c);
  d.tick(1);
  assert.deepEqual([...captions], ["Over A"], "nothing to follow: skipped to the landmark");

  available = true;
  const d2 = new Drift(map, [follow, A], 0, 1);
  d2.onCaption = (c) => captions.push(c);
  d2.tick(1);
  assert.equal(captions.at(-1), "Riding along");
  d2.tick(13); // approach glide done
  pos = [-93.2, 44.97];
  for (let t = 14; t < 20; t += 0.016) d2.tick(t);
  assert.ok(Math.abs(map.cam().center[0] - -93.2) < 0.001, "camera caught up with the subject");
  pos = undefined; // subject gone (left the map, or the train reached its end)
  d2.tick(21);
  assert.equal(captions.at(-1), "Over A", "moved on");
});

test("onResume fires when the tour starts, and again after an input restarts the idle clock", () => {
  const map = fakeMap();
  const d = new Drift(map, [A, B], 0, 10);
  let resumed = 0;
  d.onResume = () => resumed++;
  d.tick(9);
  assert.equal(resumed, 0);
  d.tick(10);
  assert.equal(resumed, 1);
  d.tick(11);
  assert.equal(resumed, 1, "not again while it's already touring");
  d.wake(20);
  d.tick(29);
  assert.equal(resumed, 1, "the idle clock restarted at the input");
  d.tick(30);
  assert.equal(resumed, 2);
});

test("a hold that ends lets the tour start on its own", () => {
  const map = fakeMap();
  const d = new Drift(map, [A, B], 0, 10);
  let held = true;
  d.holdStill = () => held;
  d.tick(100);
  assert.equal(d.drifting, false, "held still, however long");
  held = false;
  d.tick(100);
  assert.equal(d.drifting, false, "the idle clock ran while held, so it restarts from release");
  d.tick(110);
  assert.equal(d.drifting, true);
});
