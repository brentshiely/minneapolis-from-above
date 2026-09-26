import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeGauge, parseDetail, parseGauges, sameWater, waterBody, type Gauge } from "../src/water/gauges.ts";
import { onRequestGet, resetWaterCache } from "../functions/api/water.ts";

const fx = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const list = parseGauges(fx("nwps-gauges.json"));

test("parses current gauges and skips ones without a reading", () => {
  assert.ok(list.length > 30, `${list.length} gauges`);
  assert.ok(!list.some((g) => g.lid === "SGCM5"), "Shingle Creek has no current reading");
  const mtka = list.find((g) => g.lid === "MTKM5")!;
  assert.equal(mtka.body, "Lake Minnetonka");
  assert.equal(mtka.stage, 928.31);
});

test("water body names come from gauge names", () => {
  assert.equal(waterBody("Mississippi River at St. Paul Ford Plant"), "Mississippi River");
  assert.equal(waterBody("Lake Minnetonka above Gray's Dam"), "Lake Minnetonka");
  assert.equal(waterBody("Elm Creek (MN) at Champlin"), "Elm Creek");
  assert.equal(waterBody("St. Croix River near Prescott"), "St. Croix River");
  assert.ok(sameWater("Saint Croix River", "St. Croix River"));
  assert.ok(sameWater("Mississippi River", "mississippi river"));
  assert.ok(!sameWater("Minnesota River", "Mississippi River"));
});

test("detail: flood stages, the last day's change, and no crest when the forecast is flat", () => {
  const d = parseDetail(fx("nwps-stpm5.json"), fx("nwps-stpm5-stageflow.json"), Date.parse("2026-09-26T18:00:00Z") / 1000);
  assert.equal(d.floodStage, 14);
  assert.equal(d.actionStage, 10);
  assert.equal(typeof d.change24h, "number");
  assert.equal(d.crest, undefined);
});

test("detail: a forecast rise becomes a crest", () => {
  const obs = [{ validTime: "2026-04-01T12:00:00Z", primary: 8 }, { validTime: "2026-04-02T12:00:00Z", primary: 9 }];
  const fc = [{ validTime: "2026-04-03T12:00:00Z", primary: 11 }, { validTime: "2026-04-04T12:00:00Z", primary: 12.4 }];
  const d = parseDetail({}, { observed: { data: obs }, forecast: { data: fc } }, Date.parse("2026-04-02T13:00:00Z") / 1000);
  assert.equal(d.change24h, 1);
  assert.equal(d.crest?.stage, 12.4);
});

const g = (over: Partial<Gauge>): Gauge => ({
  lid: "STPM5", name: "Mississippi River at St. Paul", body: "Mississippi River", lat: 44.94, lon: -93.09,
  stage: 3.58, flowKcfs: 11.9, category: "no_flooding", t: 1_000_000, ...over,
});

test("describes a river gauge in plain language", () => {
  const d = describeGauge(g({}), { floodStage: 14, change24h: 0.4 }, 1_000_000 + 40 * 60);
  assert.equal(d.title, "Mississippi River at Saint Paul.");
  assert.equal(d.detail, "3.6 feet on the gauge, up 0.4 feet in the last day. Flowing at 11,900 cubic feet a second. Flood stage is 14.0 feet, about 10.4 feet above today's level.");
  assert.equal(d.meta, "NWS gauge STPM5 · updated 40 minutes ago");
});

test("lakes that report elevation read as feet above sea level", () => {
  const d = describeGauge(g({ lid: "MTKM5", name: "Lake Minnetonka above Gray's Dam", body: "Lake Minnetonka", stage: 928.31, flowKcfs: null }), { change24h: 0.02 }, 1_000_000);
  assert.equal(d.detail, "928.3 feet above sea level, steady over the last day.");
});

test("flooding and forecasts", () => {
  const flooding = describeGauge(g({ stage: 15.2, category: "minor" }), { floodStage: 14 });
  assert.match(flooding.detail!, /In minor flood; flood stage is 14\.0 feet\./);
  const rising = describeGauge(g({}), { floodStage: 14, crest: { stage: 6.1, t: Date.parse("2026-10-06T12:00:00Z") / 1000 } });
  assert.match(rising.detail!, /Forecast to rise to 6\.1 feet by Tuesday\./);
});

test("the endpoint rides out a brief NWS outage on the last good list", async (t) => {
  const real = globalThis.fetch;
  t.after(() => { globalThis.fetch = real; });
  resetWaterCache();
  const req = { request: new Request("http://x/api/water") };
  globalThis.fetch = (async () => new Response(JSON.stringify(fx("nwps-gauges.json")))) as typeof fetch;
  assert.equal((await onRequestGet(req)).status, 200);
  globalThis.fetch = (async () => new Response("", { status: 502 })) as typeof fetch;
  const during = await onRequestGet(req);
  assert.equal(during.status, 200, "served the last good list");
  assert.ok(((await during.json()) as { gauges: unknown[] }).gauges.length > 30);
  resetWaterCache();
  assert.equal((await onRequestGet(req)).status, 502, "nothing cached: a clear error");
});
