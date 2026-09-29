import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { startFeed, startPoller, POLL_MS } from "../src/live/feed.ts";

const flush = () => new Promise((r) => setImmediate(r));

test("polls every interval, skips unchanged snapshots, and pauses while hidden", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  let calls = 0, feedT = 100;
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ t: feedT, v: [] })); }) as typeof fetch;

  const snapshots: number[] = [];
  const feed = startFeed((ft) => snapshots.push(ft));
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(snapshots, [100]);

  mock.timers.tick(POLL_MS); await flush();
  assert.equal(calls, 2);
  assert.deepEqual(snapshots, [100], "same feed time is skipped");

  feed.pause();
  mock.timers.tick(POLL_MS * 4); await flush();
  assert.equal(calls, 2, "no polling while paused");

  feedT = 160;
  feed.resume(); await flush();
  assert.equal(calls, 3, "resume fetches immediately");
  assert.deepEqual(snapshots, [100, 160]);
  feed.pause();
});

test("counts failures and recovers", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  t.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; });
  console.warn = () => {};
  let fail = true;
  globalThis.fetch = (async () => fail ? new Response("", { status: 502 }) : new Response(JSON.stringify({ t: 5, v: [] }))) as typeof fetch;

  const feed = startFeed(() => {});
  await flush();
  assert.equal(feed.status.failures, 1);
  assert.equal(feed.status.lastOk, 0);
  fail = false;
  mock.timers.tick(POLL_MS); await flush();
  assert.equal(feed.status.failures, 0);
  assert.ok(feed.status.lastOk > 0);
  feed.pause();
});

test("with back-off, a failing feed is asked less and less often", async (t) => {
  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  t.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; });
  let warnings = 0;
  console.warn = () => { warnings++; };
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("", { status: 502 }); }) as typeof fetch;
  const feed = startPoller("/api/x", 5_000, () => {}, { maxMs: 60_000 });
  await flush();                                          // 1st call fails
  mock.timers.tick(5_000); await flush();                 // 2nd, after 5 s
  mock.timers.tick(5_000); await flush();
  assert.equal(calls, 2, "3rd waits 10 s, not 5");
  mock.timers.tick(5_000); await flush();
  assert.equal(calls, 3);
  mock.timers.tick(10 * 60_000); await flush();
  assert.ok(calls < 16, `${calls} calls in 10 minutes`);
  assert.equal(warnings, 1, "one warning per outage");
  feed.pause();
});

test("a feed counts as down after repeated failures, not one blip or a pause", async () => {
  const { isDown } = await import("../src/live/feed.ts");
  assert.equal(isDown(undefined), false);
  assert.equal(isDown({ lastOk: 0, failures: 1, paused: false }), false);
  assert.equal(isDown({ lastOk: 0, failures: 2, paused: false }), true);
  assert.equal(isDown({ lastOk: 5, failures: 9, paused: true }), false);
});
