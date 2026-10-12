import { test } from "node:test";
import assert from "node:assert/strict";
import { amtrakRows } from "../functions/api/amtrak.ts";
import { AmtrakFleet, describeAmtrak, lateness, snapToRail, type AmtrakRow } from "../src/rail/amtrak.ts";
import { buildShape } from "../src/transit/data.ts";
import type { RailLine } from "../src/rail/rail.ts";

const M_PER_DEG_LON = 111_320 * Math.cos((44.9 * Math.PI) / 180);
const NOW = 1_800_000_000;

/** A line running due east for 20 km from (-93.3, 44.9). */
const east: RailLine = {
  rr: "BNSF", trainsPerDay: 20, topSpeedMph: 60,
  shape: buildShape("e", "BNSF", [[-93.3, 44.9], [-93.3 + 20_000 / M_PER_DEG_LON, 44.9]]),
};

const row = (over: Partial<AmtrakRow> = {}): AmtrakRow => ({
  id: "8-10", num: "8", route: "Empire Builder", lat: 44.9, lon: -93.3 + 5_000 / M_PER_DEG_LON, mph: 60, heading: "E",
  at: NOW, late: 12, next: "St. Paul - Minneapolis Union", from: "Seattle King Street", to: "Chicago Union", ...over,
});

test("amtrakRows keeps active trains inside the map's reach and works out lateness at the next stop", () => {
  const rows = amtrakRows({
    "8": [{
      routeName: "Empire Builder", trainNum: "8", trainID: "8-10", lat: 45.32, lon: -93.67, velocity: 74.4, heading: "E", trainState: "Active",
      eventCode: "MSP", eventName: "St. Paul - Minneapolis Union", origName: "Seattle King Street", destName: "Chicago Union",
      lastValTS: "2026-10-12T08:10:39-05:00",
      stations: [{ code: "SCD", arr: "x" }, { code: "MSP", schArr: "2026-10-12T08:33:00-05:00", arr: "2026-10-12T09:29:00-05:00" }],
    }],
    "7": [{ routeName: "Empire Builder", trainNum: "7", trainID: "7-10", lat: 47.4, lon: -120.2, trainState: "Active" }],
    "9": [{ routeName: "Somewhere", trainNum: "9", trainID: "9-10", lat: 45, lon: -93, trainState: "Predeparture" }],
  }, Date.parse("2026-10-12T14:00:00Z") / 1000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "8-10");
  assert.equal(rows[0].late, 56);
  assert.equal(rows[0].mph, 74);
  assert.equal(rows[0].next, "St. Paul - Minneapolis Union");
});

test("lateness in words", () => {
  assert.equal(lateness(null), undefined);
  assert.equal(lateness(3), "on time");
  assert.equal(lateness(-4), "on time");
  assert.equal(lateness(56), "56 minutes late");
  assert.equal(lateness(-12), "12 minutes early");
});

test("a train is snapped to a line it is on, not one far away", () => {
  assert.ok(snapToRail([east], [-93.3 + 5_000 / M_PER_DEG_LON, 44.9005]));
  assert.equal(snapToRail([east], [-93.3 + 5_000 / M_PER_DEG_LON, 44.95]), undefined);
});

test("a train runs on along its line at its reported speed, in the direction it heads", () => {
  const fleet = new AmtrakFleet(() => [east]);
  fleet.update([row()], NOW);
  fleet.advance(NOW);
  const head0 = fleet.trains[0].path[fleet.trains[0].path.length - 1][0];
  fleet.advance(NOW + 60);
  const head1 = fleet.trains[0].path[fleet.trains[0].path.length - 1][0];
  // 60 mph for a minute is about 1.6 km east.
  assert.ok(Math.abs((head1 - head0) * M_PER_DEG_LON - 1609) < 60, `${(head1 - head0) * M_PER_DEG_LON} m`);
  fleet.update([row({ id: "8-11", heading: "W" })], NOW);
  fleet.advance(NOW + 60);
  const west = fleet.trains.find((t) => t.row.id === "8-11")!;
  assert.ok(west.path[west.path.length - 1][0] < west.path[0][0], "heading west: the head is the west end");
});

test("a train off every line is drawn where it was reported; one unreported for a long time is dropped", () => {
  const fleet = new AmtrakFleet(() => [east]);
  fleet.update([row({ lat: 46 })], NOW);
  fleet.advance(NOW);
  assert.equal(fleet.trains[0].onLine, false);
  fleet.advance(NOW + 3600);
  assert.equal(fleet.trains.length, 0);
});

test("trains missing from a new report are forgotten", () => {
  const fleet = new AmtrakFleet(() => [east]);
  fleet.update([row()], NOW);
  fleet.update([], NOW + 60);
  fleet.advance(NOW + 60);
  assert.equal(fleet.trains.length, 0);
});

test("describeAmtrak names the train, where it is bound, and how late it is", () => {
  const d = describeAmtrak(row(), NOW + 30);
  assert.match(d.title, /Empire Builder, bound for Chicago Union/);
  assert.match(d.detail!, /Train 8 from Seattle King Street/);
  assert.match(d.detail!, /60 mph/);
  assert.match(d.detail!, /12 minutes late/);
  assert.match(d.meta, /30 seconds ago/);
});

test("a train reported before the rail lines load is put on its line once they have", () => {
  let lines: RailLine[] = [];
  const fleet = new AmtrakFleet(() => lines);
  fleet.update([row()], NOW);
  fleet.advance(NOW);
  assert.equal(fleet.trains[0].onLine, false);
  lines = [east];
  fleet.advance(NOW + 1);
  assert.equal(fleet.trains[0].onLine, true);
});
