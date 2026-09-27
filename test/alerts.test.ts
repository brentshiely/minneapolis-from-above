import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { decodeAlertFeed, EFFECT } from "../functions/_lib/gtfsrt.ts";
import { affectedRoutes, onRequestGet, toResponse, type AlertsResponse } from "../functions/api/alerts.ts";
import { affectedFromRows, alertCaption, majorAlert, previewAlert } from "../src/transit/alerts.ts";
import type { RouteInfo } from "../src/transit/data.ts";

const fixture = new Uint8Array(readFileSync(new URL("./fixtures/servicealerts.pb", import.meta.url)));

test("decoder matches the official GTFS-realtime bindings on a real snapshot", () => {
  const ours = decodeAlertFeed(fixture);
  const ref = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(fixture);
  const refAlerts = ref.entity.filter((e) => e.alert);

  assert.ok(ours.alerts.length > 50, `only ${ours.alerts.length} alerts`);
  assert.equal(ours.alerts.length, refAlerts.length);
  assert.equal(ours.timestamp, Number(ref.header.timestamp));

  refAlerts.forEach((e, i) => {
    const a = ours.alerts[i], alert = e.alert!;
    assert.equal(a.id, e.id);
    assert.equal(a.effect ?? 0, alert.effect ?? 0);
    assert.equal(a.cause ?? 0, alert.cause ?? 0);
    assert.equal(a.header, alert.headerText?.translation?.[0]?.text ?? "");
    assert.equal(a.description, alert.descriptionText?.translation?.[0]?.text ?? "");
    const refEntities = alert.informedEntity ?? [];
    assert.equal(a.informedEntity.length, refEntities.length);
    refEntities.forEach((ie, j) => {
      assert.equal(a.informedEntity[j].routeId ?? "", ie.routeId ?? "");
      assert.equal(a.informedEntity[j].routeType ?? 0, ie.routeType ?? 0);
      assert.equal(a.informedEntity[j].stopId ?? "", ie.stopId ?? "");
    });
  });
});

test("a rail replacement is affected even though every entity names a stop", () => {
  const feed = decodeAlertFeed(fixture);
  const green = feed.alerts.find((a) => a.id === "53009")!;
  assert.ok(green, "fixture should contain the Green Line detour (id 53009)");
  assert.equal(green.effect, EFFECT.DETOUR);
  assert.ok(green.informedEntity.every((e) => e.stopId), "every entity in this alert names a stop");
  assert.deepEqual(affectedRoutes(green), ["902"]);
});

test("a single closed stop doesn't dash the routes that stop by it", () => {
  const feed = decodeAlertFeed(fixture);
  const closure = feed.alerts.find((a) => a.id === "41775")!;
  assert.ok(closure, "fixture should contain the stop closure (id 41775)");
  assert.ok(closure.informedEntity.length > 1, "affects several routes at one stop");
  assert.deepEqual(affectedRoutes(closure), []);
});

test("a real street detour with no stop scoping is affected", () => {
  const feed = decodeAlertFeed(fixture);
  const detour = feed.alerts.find((a) => a.id === "45891")!;
  assert.ok(detour, "fixture should contain the Route 645 detour (id 45891)");
  assert.ok(detour.informedEntity.every((e) => !e.stopId));
  assert.deepEqual(affectedRoutes(detour), ["645"]);
});

test("an elevator outage never dashes the route", () => {
  const feed = decodeAlertFeed(fixture);
  const elevator = feed.alerts.find((a) => a.id === "42192")!;
  assert.ok(elevator, "fixture should contain the Franklin Ave elevator alert (id 42192)");
  assert.equal(elevator.effect, EFFECT.ACCESSIBILITY_ISSUE);
  assert.deepEqual(affectedRoutes(elevator), []);
});

test("toResponse rows are compact and cover the Green Line detour", () => {
  const body = toResponse(fixture);
  assert.ok(body.t > 1.7e9);
  assert.ok(body.a.length > 10);
  const green = body.a.find((r) => r[1] === "902")!;
  assert.ok(green, "no row for the Green Line");
  const [id, routeId, effect, header, description] = green;
  assert.equal(id, "53009");
  assert.equal(routeId, "902");
  assert.equal(effect, EFFECT.DETOUR);
  assert.match(header, /Green Line/);
  assert.ok(description.length > 0);
  // Stop-closure noise never makes it into the response.
  assert.ok(!body.a.some((r) => r[0] === "41775"));
});

test("handler returns JSON with a longer cache, and a clear 502 when upstream fails", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(fixture);
    const ok = await onRequestGet();
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("cache-control")!, /max-age=60/);
    const body = (await ok.json()) as AlertsResponse;
    assert.ok(body.a.length > 10);

    globalThis.fetch = async () => new Response("nope", { status: 503 });
    const bad = await onRequestGet();
    assert.equal(bad.status, 502);
    assert.match(((await bad.json()) as { error: string }).error, /503/);

    globalThis.fetch = async () => { throw new TypeError("network down"); };
    assert.equal((await onRequestGet()).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- client-side grouping and captioning -------------------------------------

const ROUTES: Record<string, RouteInfo> = {
  "902": { name: "Green Line", long: "METRO Green Line", mode: "rail", color: "#008144", sort: 2 },
  "645": { name: "645", long: "Route 645", mode: "bus", color: "#608CB2", sort: 90 },
};

test("affectedFromRows keeps the first alert to claim a route", () => {
  const rows: [string, string, number, string, string][] = [
    ["a1", "645", EFFECT.OTHER_EFFECT, "first", "first desc"],
    ["a2", "645", EFFECT.DETOUR, "second", "second desc"],
  ];
  const m = affectedFromRows(rows);
  assert.equal(m.size, 1);
  assert.equal(m.get("645")!.header, "first");
});

test("majorAlert picks the rail alert over a lone bus detour", () => {
  const rows: [string, string, number, string, string][] = [
    ["a1", "645", EFFECT.OTHER_EFFECT, "Route 645 detoured off Wayzata Blvd.", ""],
    ["a2", "902", EFFECT.DETOUR, "Buses will replace METRO Green Line trains between Union Depot and Raymond Ave. stations.", ""],
  ];
  const major = majorAlert(rows, ROUTES);
  assert.equal(major?.routeId, "902");
});

test("majorAlert ignores a lone bus detour but catches one alert affecting many routes", () => {
  const one = majorAlert([["a1", "645", EFFECT.OTHER_EFFECT, "detour", ""]], ROUTES);
  assert.equal(one, undefined);

  const wide = majorAlert(
    ["2", "3", "9", "38"].map((r): [string, string, number, string, string] => ["big", r, EFFECT.DETOUR, "Several routes detoured for a downtown closure.", ""]),
    ROUTES,
  );
  assert.ok(wide);
});

test("alertCaption names the line and drops the redundant METRO phrase", () => {
  const caption = alertCaption(ROUTES, [
    ["53009", "902", EFFECT.DETOUR, "Buses will replace METRO Green Line trains between Union Depot and Raymond Ave. stations.", ""],
  ]);
  assert.ok(caption?.startsWith("Green Line: "));
  assert.ok(!/METRO/.test(caption!));
});

test("alertCaption is undefined with nothing major to report", () => {
  assert.equal(alertCaption(ROUTES, [["a1", "645", EFFECT.OTHER_EFFECT, "detour", ""]]), undefined);
  assert.equal(alertCaption(ROUTES, []), undefined);
});

test("previewAlert serves a synthetic snapshot for known specs and nothing for unknown ones", () => {
  const blue = previewAlert("blueline-detour");
  assert.ok(blue);
  assert.equal(blue!.a[0][1], "901");
  assert.equal(previewAlert("not-a-real-preset"), undefined);
  assert.equal(previewAlert(""), undefined);
});
