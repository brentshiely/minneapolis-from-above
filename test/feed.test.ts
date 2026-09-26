import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { startFeed, POLL_MS } from "../src/live/feed.ts";

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
