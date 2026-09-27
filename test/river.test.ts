import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LOCKS, alongPath, boatName, boatsAt, centralTime, describeLock, describePassage, glanceSignature, mergePassages,
  parseLockTime, parseQueue, vesselName, when, type Passage, type RiverResponse,
} from "../src/river/river.ts";
import { BUDGET_PER_MIN, FRESH_S, GLANCE_URL, onRequestGet, queueUrl, resetRiverCache } from "../functions/api/river.ts";

// Saved from the Corps' service on 2026-09-26 around 7:56 PM Central.
const raw = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const fx = (f: string) => JSON.parse(raw(f));
const iso = (s: string) => Date.parse(s) / 1000;
const NOW = iso("2026-09-27T00:56:00Z");

test("lock times are Minneapolis wall-clock time, daylight saving included", () => {
  assert.equal(parseLockTime("09/26/26 13:49"), iso("2026-09-26T18:49:00Z"));
  assert.equal(parseLockTime("2026-09-26T13:49:00"), iso("2026-09-26T18:49:00Z"));
  assert.equal(centralTime(2026, 1, 15, 9, 0), iso("2026-01-15T15:00:00Z"));
  assert.equal(parseLockTime("soon"), undefined);
});

test("parses a lock's queue", () => {
  const one = parseQueue("01", fx("lpms-queue-01.json"));
  assert.equal(one.length, 100);
  const anson = one.find((p) => p.vessel === "ANSON NORTHRUP" && p.done === iso("2026-09-26T18:49:00Z"))!;
  assert.deepEqual(anson, { lock: "01", vessel: "ANSON NORTHRUP", up: false, barges: 0, arrived: iso("2026-09-26T18:13:00Z"), done: iso("2026-09-26T18:49:00Z"), rec: false });
  const rec = one.filter((p) => p.rec);
  assert.ok(rec.length > 50 && rec.every((p) => p.vessel === ""), "pleasure boats have no name");
});

test("a tow locked through in two cuts is one passage", () => {
  const two = parseQueue("02", fx("lpms-queue-02.json"));
  const aaron = two.filter((p) => p.vessel === "AARON F BARRETT" && p.arrived === iso("2026-09-24T23:46:00Z"));
  assert.equal(aaron.length, 1);
  assert.equal(aaron[0].done, iso("2026-09-25T02:18:00Z"));
  assert.equal(aaron[0].barges, 6);
  assert.ok(two.some((p) => p.vessel === "USCG WYACONDA"), "names are trimmed");
});

test("keeps the last day, and a few passages per lock however old", () => {
  const all = mergePassages([parseQueue("01", fx("lpms-queue-01.json")), parseQueue("02", fx("lpms-queue-02.json"))], NOW);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].done >= all[i].done, "newest first");
  assert.ok(all.every((p, i) => NOW - p.done < 86400 || all.slice(0, i + 1).filter((q) => q.lock === p.lock).length <= 3));
  assert.equal(all.filter((p) => p.lock === "02").length, 3);
  const later = mergePassages([parseQueue("01", fx("lpms-queue-01.json"))], NOW + 30 * 86400);
  assert.equal(later.length, 3);
});

test("river at a glance: a signature of each lock's latest lockage", () => {
  assert.equal(glanceSignature(fx("lpms-glance.json")), "01|0930434|2026-09-26T13:49:00,02|9999999|2026-09-26T18:45:00");
  assert.equal(glanceSignature({ error: "Rate limit exceeded" }), "");
});

test("vessel names read like names, and keep their initials", () => {
  assert.equal(vesselName("MARGARET D"), "Margaret D");
  assert.equal(vesselName("HFL MARINER"), "HFL Mariner");
  assert.equal(vesselName("J L FLEMING"), "J L Fleming");
  assert.equal(vesselName("VIKING MISSISSPPI"), "Viking Mississippi");
  const p = (vessel: string, over: Partial<Passage> = {}): Passage => ({ lock: "01", vessel, up: true, barges: 0, arrived: 0, done: 0, rec: false, ...over });
  assert.equal(boatName(p("ANSON NORTHRUP")), "Riverboat Anson Northrup");
  assert.equal(boatName(p("USCG WYACONDA")), "Coast Guard cutter Wyaconda");
  assert.equal(boatName(p("CAPT BOWE")), "Towboat Capt Bowe");
  assert.equal(boatName(p("", { rec: true })), "A recreational boat");
});

test("times read as a clock, a day, or a date", () => {
  assert.equal(when(iso("2026-09-26T18:49:00Z"), NOW), "at 1:49 PM");
  assert.equal(when(iso("2026-09-25T22:20:00Z"), NOW), "yesterday at 5:20 PM");
  assert.equal(when(iso("2026-09-22T16:10:00Z"), NOW), "on Tuesday at 11:10 AM");
  assert.equal(when(iso("2026-09-12T18:56:00Z"), NOW), "on September 12 at 1:56 PM");
});

const margaret: Passage = { lock: "02", vessel: "MARGARET D", up: true, barges: 3, arrived: iso("2026-09-26T17:10:00Z"), done: iso("2026-09-26T17:49:00Z"), rec: false };

test("describes a towboat through a lock", () => {
  const d = describePassage(margaret, margaret.done + 40 * 60);
  assert.equal(d.title, "Towboat Margaret D heading upstream with 3 barges, through Lock and Dam 2 at 12:49 PM.");
  assert.equal(d.detail, "Drawn near the lock where it was logged, not where it is now.");
  assert.equal(d.meta, "Army Corps of Engineers lock log · 40 minutes ago");
  assert.equal(describePassage({ ...margaret, barges: 1, up: false }, margaret.done).title,
    "Towboat Margaret D heading downstream with 1 barge, through Lock and Dam 2 at 12:49 PM.");
  assert.equal(describePassage({ ...margaret, vessel: "", rec: true, barges: 0 }, margaret.done + 3 * 3600).title,
    "A recreational boat heading upstream, through Lock and Dam 2 at 12:49 PM.");
});

test("describes a lock and its last few passages", () => {
  const one = parseQueue("01", fx("lpms-queue-01.json")).filter((p) => p.done <= iso("2026-09-26T18:49:00Z"));
  const d = describeLock(LOCKS["01"], one, NOW);
  assert.equal(d.title, "Lock and Dam 1.");
  assert.equal(d.detail, "Lifts and lowers boats about 38 feet around the Ford Dam, between Minneapolis and Saint Paul. "
    + "Last through: Anson Northrup, heading downstream, no barges, at 1:49 PM; a recreational boat, heading upstream, at 1:25 PM; "
    + "a recreational boat, heading upstream, at 1:10 PM.");
  assert.equal(d.meta, "Mississippi River mile 847.6 · Army Corps of Engineers");
  assert.equal(describeLock(LOCKS["02"], [], NOW).detail?.endsWith("No boats logged here in the last month."), true);
});

test("recent boats start at their lock, drift their way along the river, and fade", () => {
  const at = (s: number) => boatsAt([margaret], margaret.done + s)[0];
  const fresh = at(0), later = at(2 * 3600);
  assert.deepEqual(fresh.position, LOCKS["02"].at);
  assert.equal(fresh.alpha, 1);
  // Upstream at Lock and Dam 2 is northwest, toward Saint Paul.
  assert.ok(later.position[0] < fresh.position[0] && later.position[1] > fresh.position[1]);
  assert.ok(later.heading > 270 && later.heading < 330, `${later.heading}`);
  assert.ok(at(3.8 * 3600).alpha < 0.2);
  assert.equal(at(4 * 3600), undefined);
  // Downstream at Lock and Dam 1 is south, toward the Minnesota River.
  const down = boatsAt([{ ...margaret, lock: "01", up: false }], margaret.done + 3600)[0];
  assert.ok(down.position[1] < LOCKS["01"].at[1]);
});

test("a walk along a path stops at its end", () => {
  const path: [number, number][] = [[0, 0], [0, 0.001], [0, 0.002]];
  assert.deepEqual(alongPath(path, 0, 1e6, true).position, [0, 0.002]);
  assert.equal(Math.round(alongPath(path, 2, 50, false).heading), 180);
});

// --- the function ---------------------------------------------------------------------

const read = async (r: Response) => (await r.json()) as RiverResponse & { error?: string };

function mockCorps(answers: Record<string, () => string>) {
  const calls: string[] = [];
  /** When each call was made, by the (mocked) clock. */
  const at: number[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    at.push(Date.now() / 1000);
    const body = answers[url]?.();
    if (body === undefined) return new Response("not found", { status: 404 });
    // The service labels its JSON as HTML.
    return new Response(body, { status: 200, headers: { "content-type": "text/html;charset=utf-8" } });
  });
  return { calls, at, restore: () => fetchMock.mock.restore() };
}

test("the function checks the glance, then the queues only when something new locked through", async () => {
  resetRiverCache();
  let clock = NOW * 1000;
  const dateMock = mock.method(Date, "now", () => clock);
  let glance = raw("lpms-glance.json");
  const corps = mockCorps({
    [GLANCE_URL]: () => glance,
    [queueUrl("01")]: () => raw("lpms-queue-01.json"),
    [queueUrl("02")]: () => raw("lpms-queue-02.json"),
  });
  try {
    const first = await read(await onRequestGet());
    assert.equal(corps.calls.length, 3);
    assert.equal(first.p[0].vessel, "", "a pleasure boat was the latest");
    assert.ok(first.p.some((p: Passage) => p.vessel === "ANSON NORTHRUP"));

    await onRequestGet();
    assert.equal(corps.calls.length, 3, "cached for 5 minutes");

    clock += (FRESH_S + 1) * 1000;
    const same = await read(await onRequestGet());
    assert.equal(corps.calls.length, 4, "nothing new: only the glance");
    assert.deepEqual(same.p, first.p);

    clock += (FRESH_S + 1) * 1000;
    glance = glance.replace("18:45:00", "20:15:00");
    await onRequestGet();
    assert.equal(corps.calls.length, 7, "something new: both queues again");
  } finally {
    corps.restore();
    dateMock.mock.restore();
  }
});

test("when the Corps is rate-limiting, the last good list is served and it isn't asked again for a while", async () => {
  resetRiverCache();
  let clock = NOW * 1000;
  const dateMock = mock.method(Date, "now", () => clock);
  let limited = false;
  const corps = mockCorps({
    [GLANCE_URL]: () => (limited ? '{"error":"Rate limit exceeded. Please try again later."}' : raw("lpms-glance.json")),
    [queueUrl("01")]: () => raw("lpms-queue-01.json"),
    [queueUrl("02")]: () => raw("lpms-queue-02.json"),
  });
  try {
    const good = await read(await onRequestGet());
    limited = true;
    clock += (FRESH_S + 1) * 1000;
    const res = await onRequestGet();
    assert.equal(res.status, 200);
    assert.deepEqual((await read(res)).p, good.p);
    assert.equal(corps.calls.length, 4);
    clock += 60_000;
    await onRequestGet();
    assert.equal(corps.calls.length, 4, "backs off after a refusal");

    // With nothing to fall back on: a quiet river and why, not an error.
    resetRiverCache();
    const bad = await onRequestGet();
    assert.equal(bad.status, 200);
    const body = await read(bad);
    assert.deepEqual(body.p, []);
    assert.match((body as { unavailable?: string }).unavailable ?? "", /Rate limit exceeded/);
  } finally {
    corps.restore();
    dateMock.mock.restore();
  }
});

test("never more than 5 requests a minute, however many viewers ask", async () => {
  resetRiverCache();
  let clock = NOW * 1000;
  const dateMock = mock.method(Date, "now", () => clock);
  let n = 0;
  // The worst case: every glance looks new, so every refresh wants all three
  // requests, and the Corps sometimes refuses, so there's often nothing fresh.
  const corps = mockCorps({
    [GLANCE_URL]: () => raw("lpms-glance.json").replace("18:45:00", `18:${String(n++ % 60).padStart(2, "0")}:00`),
    [queueUrl("01")]: () => (n % 3 ? raw("lpms-queue-01.json") : '{"error":"Rate limit exceeded."}'),
    [queueUrl("02")]: () => raw("lpms-queue-02.json"),
  });
  try {
    for (let s = 0; s < 3600; s += 7) {
      clock = (NOW + s) * 1000;
      await Promise.all(Array.from({ length: 20 }, () => onRequestGet()));
    }
    assert.ok(corps.at.length > 12, `${corps.at.length} calls`);
    assert.ok(BUDGET_PER_MIN <= 5);
    for (const t of corps.at) {
      const inMinute = corps.at.filter((u) => u >= t && u < t + 60).length;
      assert.ok(inMinute <= BUDGET_PER_MIN, `${inMinute} calls in the minute from ${t - NOW} s`);
    }
  } finally {
    corps.restore();
    dateMock.mock.restore();
  }
});
