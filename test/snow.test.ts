import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { findDate, parseMinneapolis, parseSaintPaul, plainText } from "../src/snow/status.ts";
import { mplsDayAt, previewSnow, routeRule, snowCaption, stageAt, stpPhaseAt, type CityStatus, type SnowResponse } from "../src/snow/rules.ts";
import { parseSnowRoutes } from "../src/snow/routes.ts";
import { onRequestGet, resetSnowCache } from "../functions/api/snow.ts";

const read = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const json = (f: string) => JSON.parse(read(f));
const html = (f: string) => new TextDecoder().decode(gunzipSync(readFileSync(new URL(`./fixtures/${f}`, import.meta.url))));
/** A moment in Minneapolis time (Central Standard Time in winter). */
const cst = (s: string) => new Date(`${s}-06:00`);

// Real responses from the city's notice feed: January 8, 2026 (no
// emergency), April 2026 (street sweeping, nothing about snow), today
// (empty), and two archived during emergencies in February 2023.

test("Minneapolis: the winter notice saying no emergency reads as none", () => {
  const s = parseMinneapolis(json("snow-mpls-not-in-effect.json"), cst("2026-01-08T10:00:00"));
  assert.deepEqual([s.ok, s.declared], [true, false]);
  assert.equal(s.message, "A snow emergency is not currently in effect. Normal parking rules apply.");
});

test("Minneapolis: other notices and the empty off-season feed read as none", () => {
  for (const f of ["snow-mpls-street-sweeping.json", "snow-mpls-offseason.json"]) {
    const s = parseMinneapolis(json(f), cst("2026-04-22T10:00:00"));
    assert.deepEqual([s.ok, s.declared], [true, false], f);
  }
});

test("Minneapolis: anything that isn't the notice feed fails quiet", () => {
  for (const body of [null, "nope", { notices: "x" }, {}]) {
    const s = parseMinneapolis(body);
    assert.deepEqual([s.ok, s.declared], [false, false]);
  }
});

test("Minneapolis: the February 22, 2023 emergency, stage by scheduled stage", () => {
  const feed = json("snow-mpls-declared-2023-02-22.json");
  const at = (t: string) => {
    const now = cst(t);
    const s = parseMinneapolis(feed, now);
    return { s, stage: stageAt("mpls", s, now) };
  };
  assert.equal(at("2023-02-22T10:00:00").s.declared, false, "before it was declared");

  const declared = at("2023-02-22T16:00:00");
  assert.equal(declared.s.message, "The City has declared a Snow Emergency. Day 1 rules begin at 9 p.m. tonight.");
  assert.equal(declared.s.declaredOn, "2023-02-22");
  assert.deepEqual(declared.stage, { city: "mpls", day: 1, before: true });

  assert.deepEqual(at("2023-02-22T23:00:00").stage, { city: "mpls", day: 1 });
  assert.deepEqual(at("2023-02-23T13:00:00").stage, { city: "mpls", day: 2 });
  const overnight = at("2023-02-23T22:00:00");
  assert.match(overnight.s.message!, /^A Snow Emergency is in effect\. Day 2 ended at 8 p\.m\./);
  assert.deepEqual(overnight.stage, { city: "mpls", day: 3, before: true });
  const day3 = at("2023-02-24T13:00:00");
  assert.equal(day3.s.declaredOn, "2023-02-22");
  assert.deepEqual(day3.stage, { city: "mpls", day: 3 });
  // Day 3's notice came down at 7:58 p.m.; the standing notice is back.
  const over = at("2023-02-24T20:30:00");
  assert.equal(over.s.declared, false);
  assert.equal(over.s.message, "There's currently no Snow Emergency. Normal parking rules apply.");
});

test("Minneapolis: a stage's notice runs out on its own clock", () => {
  // Parsed at 7:55 p.m. on day 2; five minutes later day 2 is over.
  const s = parseMinneapolis(json("snow-mpls-declared-2023-02-22.json"), cst("2023-02-23T19:55:00"));
  assert.deepEqual(stageAt("mpls", s, cst("2023-02-23T19:55:00")), { city: "mpls", day: 2 });
  assert.deepEqual(stageAt("mpls", s, cst("2023-02-23T20:05:00")), { city: "mpls", day: 3, before: true });
});

test("Minneapolis: the one-day emergency of February 24, 2023", () => {
  const feed = json("snow-mpls-one-day-2023-02-24.json");
  const s = parseMinneapolis(feed, cst("2023-02-24T22:00:00"));
  assert.equal(s.declared, true);
  assert.equal(s.message, "A one-day Snow Emergency has been declared for tonight, from 9 p.m. Feb. 24 to 8 a.m. Feb. 25.");
  assert.deepEqual(stageAt("mpls", s, cst("2023-02-24T22:00:00")), { city: "mpls", day: 1 });
  assert.deepEqual(stageAt("mpls", s, cst("2023-02-25T07:30:00")), { city: "mpls", day: 1 });
  assert.equal(stageAt("mpls", s, cst("2023-02-25T09:00:00")), undefined, "one day only");
});

/** The real 2026 notice with other words swapped in, for wordings not in the archive. */
function mplsNotice(message: string) {
  const real = json("snow-mpls-not-in-effect.json");
  real.notices[0].html = real.notices[0].html.replaceAll("A snow emergency is not currently in effect. Normal parking rules apply.", message);
  return real;
}

test("Minneapolis: wordings without a schedule still read right", () => {
  const dated = parseMinneapolis(mplsNotice("Snow Emergency Day 2 rules are in effect starting at 8 a.m. Thursday, Jan. 8."), cst("2026-01-08T09:00:00"));
  assert.equal(dated.day, 2);
  const undated = parseMinneapolis(mplsNotice("The City has declared a Snow Emergency. Parking rules begin at 9 p.m."), cst("2026-01-07T16:00:00"));
  assert.equal(undated.declaredOn, "2026-01-07", "the banner's own date");
  assert.deepEqual(stageAt("mpls", undated, cst("2026-01-07T16:00:00")), { city: "mpls", day: 1, before: true });
});

test("Minneapolis: near misses stay quiet", () => {
  for (const msg of [
    "Winter parking restrictions are in effect. Do not park on the even side of non-snow emergency routes.",
    "A snow emergency may be declared tomorrow. Watch for updates.",
    "The snow emergency has ended. Normal parking rules apply.",
  ]) {
    const s = parseMinneapolis(mplsNotice(msg), cst("2026-01-07T12:00:00"));
    assert.equal(s.declared, false, msg);
  }
});

// Real pages: Saint Paul's snow page today, and as archived during the
// emergencies of December 19, 2024, February 8, 2025 and November 30, 2025.

test("Saint Paul: today's page says there's no emergency", () => {
  const s = parseSaintPaul(html("snow-stp-none.html.gz"), cst("2026-09-26T12:00:00"));
  assert.deepEqual([s.ok, s.declared], [true, false]);
  assert.equal(s.message, "There is currently no Snow Emergency in effect.");
});

test("Saint Paul: the December 2024 alert, phase by phase", () => {
  const now = cst("2024-12-20T10:49:00");
  const s = parseSaintPaul(html("snow-stp-declared-2024-12-19.html.gz"), now);
  assert.deepEqual([s.ok, s.declared, s.declaredOn], [true, true, "2024-12-19"]);
  assert.equal(s.message, "A Snow Emergency for Saint Paul is now in effect.");
  assert.deepEqual(stageAt("stp", s, cst("2024-12-19T18:00:00")), { city: "stp", phase: "night", before: true });
  assert.deepEqual(stageAt("stp", s, cst("2024-12-19T22:00:00")), { city: "stp", phase: "night" });
  assert.deepEqual(stageAt("stp", s, now), { city: "stp", phase: "day" });
  assert.deepEqual(stageAt("stp", s, cst("2024-12-21T12:00:00")), { city: "stp", phase: "cleanup" });
  // "A Snow Emergency lasts 96 hours, or until December 23, 2024 at 9 p.m."
  assert.deepEqual(stageAt("stp", s, cst("2024-12-23T20:00:00")), { city: "stp", phase: "cleanup" });
  assert.equal(stageAt("stp", s, cst("2024-12-23T21:30:00")), undefined);
});

test("Saint Paul: the November 2025 alert", () => {
  const s = parseSaintPaul(html("snow-stp-declared-2025-11-30.html.gz"), cst("2025-11-30T17:37:00"));
  assert.deepEqual([s.declared, s.declaredOn], [true, "2025-11-30"]);
  assert.deepEqual(stageAt("stp", s, cst("2025-11-30T17:37:00")), { city: "stp", phase: "night", before: true });
});

test("Saint Paul: the cleanup update of February 2025", () => {
  const now = cst("2025-02-10T00:46:00");
  const s = parseSaintPaul(html("snow-stp-cleanup-2025-02-10.html.gz"), now);
  assert.deepEqual([s.declared, s.declaredOn, s.phase], [true, "2025-02-08", "cleanup"]);
  assert.deepEqual(stageAt("stp", s, now), { city: "stp", phase: "cleanup" });
  // Left up past the 96 hours, it no longer counts.
  assert.equal(stageAt("stp", s, cst("2025-02-13T09:00:00")), undefined);
});

test("Saint Paul: a page without the status section fails quiet", () => {
  const s = parseSaintPaul("<html><body><main>Snow</main></body></html>");
  assert.deepEqual([s.ok, s.declared], [false, false]);
});

test("dates in the cities' wording", () => {
  const jan = cst("2026-01-03T12:00:00");
  assert.equal(findDate("Thursday, 12/19/2024, all night plow routes", jan), "2024-12-19");
  assert.equal(findDate("starting Tuesday, Dec. 30", jan), "2025-12-30");
  assert.equal(findDate("January 4", cst("2025-12-30T12:00:00")), "2026-01-04");
  assert.equal(findDate("9 p.m. tonight", jan), undefined);
  assert.equal(plainText("<p>Do&nbsp;not park &amp; <strong>move</strong></p>"), "Do not park & move");
});

test("the Minneapolis day and Saint Paul phase clocks", () => {
  assert.deepEqual(mplsDayAt(0, 20.99), { day: 1, before: true });
  assert.deepEqual(mplsDayAt(0, 21), { day: 1 });
  assert.deepEqual(mplsDayAt(1, 7.9), { day: 1 });
  assert.deepEqual(mplsDayAt(1, 8), { day: 2 });
  assert.deepEqual(mplsDayAt(1, 20), { day: 3, before: true });
  assert.deepEqual(mplsDayAt(2, 7.9), { day: 3, before: true });
  assert.deepEqual(mplsDayAt(2, 19.9), { day: 3 });
  assert.equal(mplsDayAt(2, 20), undefined);
  assert.deepEqual(stpPhaseAt(1, 6.9), { phase: "night" });
  assert.deepEqual(stpPhaseAt(1, 7.5), { phase: "day", before: true });
  assert.deepEqual(stpPhaseAt(1, 16.9), { phase: "day" });
  assert.deepEqual(stpPhaseAt(1, 17), { phase: "cleanup" });
  assert.equal(stpPhaseAt(5, 1), undefined);
});

test("nothing declared, or a source that couldn't be read, shows nothing", () => {
  const none: CityStatus = { declared: false, ok: true, source: "x" };
  assert.equal(stageAt("mpls", none, new Date()), undefined);
  assert.equal(stageAt("mpls", { declared: true, ok: false, day: 2, source: "x" }, new Date()), undefined);
  assert.equal(stageAt("stp", { declared: true, ok: true, source: "x" }, new Date()), undefined, "declared, but no day or date to go on");
});

test("captions say what day it is and what it means", () => {
  assert.equal(snowCaption({ city: "mpls", day: 2 }),
    "Minneapolis snow emergency, day 2: no parking on the even side of non-snow-emergency routes, or on parkways, 8 AM to 8 PM.");
  assert.equal(snowCaption({ city: "mpls", day: 3 }),
    "Minneapolis snow emergency, day 3: no parking on the odd side of non-snow-emergency routes, 8 AM to 8 PM.");
  assert.equal(snowCaption({ city: "mpls", day: 1 }),
    "Minneapolis snow emergency, day 1: no parking on either side of snow emergency routes until they're plowed.");
  assert.match(snowCaption({ city: "mpls", day: 1, before: true }), /^Minneapolis snow emergency declared: starting 9 PM/);
  assert.match(snowCaption({ city: "mpls", day: 3, before: true }), /day 2 is over\. Overnight, move cars off the odd side/);
  assert.equal(snowCaption({ city: "stp", phase: "night" }),
    "Saint Paul snow emergency, night plow: no parking on night plow routes or anywhere downtown, 9 PM to 7 AM.");
  assert.equal(snowCaption({ city: "stp", phase: "day" }),
    "Saint Paul snow emergency, day plow: no parking on streets without night plow route signs until they're plowed to the curb, 8 AM to 5 PM.");
  assert.match(snowCaption({ city: "stp", phase: "cleanup" }), /cleanup: don't park where the street isn't plowed to the curb/);
});

test("hovering a route gives that route's rule today", () => {
  const d1 = routeRule({ city: "mpls", day: 1 }, "Lyndale Ave S");
  assert.equal(d1.title, "Lyndale Ave S: snow emergency route.");
  assert.match(d1.detail, /^No parking on either side until it's fully plowed/);
  assert.equal(d1.meta, "Minneapolis snow emergency · day 1");
  assert.match(routeRule({ city: "mpls", day: 2 }).detail, /^Parking is allowed on both sides today\. .*even side/);
  assert.match(routeRule({ city: "mpls", day: 3 }).detail, /odd side/);
  const night = routeRule({ city: "stp", phase: "night" });
  assert.equal(night.title, "Night plow route.");
  assert.match(night.detail, /^No parking on this side of the street/);
  assert.match(routeRule({ city: "stp", phase: "day" }).detail, /^Parking is allowed here again/);
});

test("?snow= previews", () => {
  assert.deepEqual(previewSnow("mpls-2"), { city: "mpls", day: 2 });
  assert.deepEqual(previewSnow("mpls-declared"), { city: "mpls", day: 1, before: true });
  assert.deepEqual(previewSnow("mpls-overnight"), { city: "mpls", day: 3, before: true });
  assert.deepEqual(previewSnow("stp-night"), { city: "stp", phase: "night" });
  assert.deepEqual(previewSnow("STP-Cleanup"), { city: "stp", phase: "cleanup" });
  assert.equal(previewSnow("mpls-4"), undefined);
  assert.equal(previewSnow(""), undefined);
});

test("baked routes: both cities, real streets, a sensible size", () => {
  const raw = read("../../public/data/snow-routes.json");
  assert.ok(raw.length < 400_000, `${raw.length} bytes`);
  const r = parseSnowRoutes(JSON.parse(raw));
  assert.ok(r.mpls.length > 200 && r.stp.length > 1000, `${r.mpls.length} / ${r.stp.length}`);
  assert.ok(r.mpls.some((x) => x.name === "Lyndale Ave S"));
  for (const x of [...r.mpls, ...r.stp]) {
    for (const [lon, lat] of x.path) assert.ok(lon > -93.4 && lon < -92.95 && lat > 44.85 && lat < 45.06, `${x.city} ${lon},${lat}`);
  }
});

test("the endpoint answers both cities, and fails quiet", async () => {
  const realFetch = globalThis.fetch;
  const body = async (res: Response) => (await res.json()) as SnowResponse;
  try {
    resetSnowCache();
    globalThis.fetch = (async (url: string) => new Response(String(url).includes("minneapolismn") ? read("snow-mpls-not-in-effect.json") : html("snow-stp-none.html.gz"))) as typeof fetch;
    const ok = await body(await onRequestGet());
    assert.deepEqual([ok.mpls.ok, ok.mpls.declared, ok.stp.ok, ok.stp.declared], [true, false, true, false]);

    // A recent answer covers a brief outage; with none, the city reports ok: false.
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    assert.equal((await body(await onRequestGet())).mpls.ok, true);
    resetSnowCache();
    const res = await onRequestGet();
    assert.equal(res.status, 200);
    const down = await body(res);
    assert.deepEqual([down.mpls.ok, down.mpls.declared, down.stp.ok, down.stp.declared], [false, false, false, false]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
