import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, describePlane, describeVehicle, parseSign, routeFits, type Airport, type PlaneFacts } from "../src/describe.ts";
import { buildShape, type RouteInfo } from "../src/transit/data.ts";

const route = (name: string, mode: RouteInfo["mode"]): RouteInfo => ({ name, long: "", mode, color: "#000000", sort: 0 });
const shape = (head: string, dir: string) => buildShape("s", "r", [[-93.27, 44.97], [-93.26, 44.97]], head, dir);

test("reads destination signs the way a rider would", () => {
  assert.deepEqual(parseSign("Selby-Lake / Lake & France"), { corridor: "Selby-Lake", to: "Lake & France" });
  assert.deepEqual(parseSign("Franklin Ave / To Central / U of M"), { corridor: "Franklin Ave", to: "Central, U of M" });
  assert.deepEqual(parseSign("Downtown Minneapolis / Via Central"), { to: "Downtown Minneapolis", via: "Central" });
  assert.deepEqual(parseSign("Dwtn Mpls / North Loop / Via Maryland"), { to: "Downtown Minneapolis, North Loop", via: "Maryland" });
  assert.deepEqual(parseSign("Dtwn St Paul / Via Front Ave"), { to: "Downtown Saint Paul", via: "Front Ave" });
  assert.deepEqual(parseSign("Johnson / Silver Lk Vlg / Via Lyndale"), { corridor: "Johnson", to: "Silver Lake Village", via: "Lyndale" });
  assert.deepEqual(parseSign("Lyndale / Via Penn / Knox - American"), { corridor: "Lyndale", to: "Knox – American", via: "Penn" });
  assert.deepEqual(parseSign("Fremont Ave / Brklyn Ctr Tc"), { corridor: "Fremont Ave", to: "Brooklyn Center Transit Center" });
  assert.deepEqual(parseSign("4Ave S / To 46St-Nicollet"), { corridor: "4th Ave S", to: "46th St-Nicollet" });
  assert.deepEqual(parseSign("Central / 53Ave-Target"), { corridor: "Central", to: "53rd Ave-Target" });
  assert.deepEqual(parseSign("Como Ave / Eustis PR"), { corridor: "Como Ave", to: "Eustis Park & Ride" });
  assert.deepEqual(parseSign("Mpls-Target Field"), { to: "Minneapolis-Target Field" });
  assert.deepEqual(parseSign("St. Paul-Union Depot"), { to: "Saint Paul-Union Depot" });
  assert.equal(parseSign("Rosedale TC").to, "Rosedale Transit Center");
  assert.deepEqual(parseSign("Express / 36-Rice P&R / Mplwd Mall"), { corridor: "36-Rice Park & Ride", to: "Maplewood Mall", service: "express" });
  assert.deepEqual(parseSign("Ltd Stop / Dtwn St Paul / Via Airport"), { to: "Downtown Saint Paul", via: "Airport", service: "limited-stop" });
  assert.deepEqual(parseSign("RED Mall of America"), { to: "Mall of America" });
  assert.deepEqual(parseSign("GREEN Eastbound / Downtown St Paul"), { to: "Downtown Saint Paul" });
  assert.deepEqual(parseSign("Trip 17 / Maple Grove / To Mpls"), { corridor: "Maple Grove", to: "Minneapolis" });
  assert.deepEqual(parseSign("Starlite Ctr / 85 Ave / Northtown"), { corridor: "Starlite Center", to: "85th Ave, Northtown" });
});

test("express buses say so, and routes that sign their own name don't repeat it", () => {
  const exp = describeVehicle({ routeId: "94", route: route("94", "bus"), shape: shape("Express / I-94 / Downtown Mpls", "EB"), vehicleId: "1", ageS: 0 });
  assert.equal(exp.title, "Route 94 (I-94) express bus to Downtown Minneapolis");
  const shuttle = describeVehicle({ routeId: "906", route: { ...route("Airport Shuttle", "rail") }, shape: shape("Airport Shuttle", "NB"), vehicleId: "2", ageS: 0 });
  assert.equal(shuttle.title, "METRO Airport Shuttle train");
});

test("a bus with a via street says so", () => {
  const d = describeVehicle({ routeId: "10", route: route("10", "bus"), shape: shape("Downtown Minneapolis / Via Central", "SB"), vehicleId: "7352", ageS: 18 });
  assert.equal(d.title, "Route 10 bus to Downtown Minneapolis, via Central");
});

test("describes a local bus", () => {
  const d = describeVehicle({ routeId: "21", route: route("21", "bus"), shape: shape("Selby-Lake / Lake & France", "WB"), vehicleId: "1403", ageS: 12 });
  assert.equal(d.title, "Route 21 (Selby-Lake) bus to Lake & France");
  assert.equal(d.detail, "Heading west.");
  assert.equal(d.meta, "Bus 1403 · updated 12 seconds ago");
});

test("describes light rail and BRT with their METRO names", () => {
  const train = describeVehicle({ routeId: "901", route: route("Blue Line", "rail"), shape: shape("Mall of America", "SB"), vehicleId: "31134", ageS: 3 });
  assert.equal(train.title, "METRO Blue Line train to Mall of America");
  assert.equal(train.detail, "Heading south.");
  assert.equal(train.meta, "Train 31134 · updated just now");
  const brt = describeVehicle({ routeId: "921", route: route("A Line", "brt"), shape: shape("Rosedale TC", "NB"), vehicleId: "8238", ageS: 70 });
  assert.equal(brt.title, "METRO A Line bus to Rosedale Transit Center");
  assert.equal(brt.meta, "Bus 8238 · updated a minute ago");
});

test("a vehicle with no route shape still gets a sensible line", () => {
  const d = describeVehicle({ routeId: "999", vehicleId: "7", ageS: 200 });
  assert.equal(d.title, "Route 999 bus");
  assert.equal(d.detail, undefined);
  assert.equal(d.meta, "Bus 7 · updated 3 minutes ago");
});

test("time phrases", () => {
  assert.equal(ago(0), "just now");
  assert.equal(ago(45), "45 seconds ago");
  assert.equal(ago(95), "2 minutes ago");
});

const MSP: Airport = { iata: "MSP", icao: "KMSP", place: "Minneapolis–Saint Paul", lat: 44.882, lon: -93.2218 };
const ATL: Airport = { iata: "ATL", icao: "KATL", place: "Atlanta", lat: 33.6367, lon: -84.4281 };
const SEA: Airport = { iata: "SEA", icao: "KSEA", place: "Seattle", lat: 47.449, lon: -122.309 };

const plane = (over: Partial<PlaneFacts>): PlaneFacts => ({
  callsign: "DAL2437", registration: "N845DN", type: "B739", altFt: 17_975, onGround: false,
  speedKt: 421, verticalFpm: 1984, heading: 150, position: [-93.1, 44.75], ageS: 2, ...over,
});

test("describes an airliner in plain language, with a route that fits", () => {
  // Departed MSP, climbing, pointed toward Atlanta.
  const d = describePlane(plane({}), { airline: "Delta Air Lines", flightNumber: "DL2437", origin: MSP, destination: ATL });
  assert.equal(d.title, "Delta flight 2437 from Minneapolis–Saint Paul to Atlanta.");
  assert.equal(d.detail, "A Boeing 737-900, climbing through 18,000 feet at 485 mph.");
  assert.equal(d.meta, "DAL2437 · N845DN · updated just now");
});

test("leaves out a route the plane clearly isn't flying", () => {
  // Same plane, but the database says Seattle to Atlanta: it's nowhere near Seattle and is climbing out of MSP.
  const d = describePlane(plane({ heading: 280 }), { airline: "Delta Air Lines", flightNumber: "DL2437", origin: SEA, destination: ATL });
  assert.equal(d.title, "Delta flight 2437.");
});

test("rejects a stale route for a plane descending into the Twin Cities", () => {
  const DAY: Airport = { iata: "DAY", icao: "KDAY", place: "Dayton", lat: 39.9024, lon: -84.2194 };
  const p = plane({ callsign: "DAL2724", type: "BCS3", altFt: 2_800, verticalFpm: -700, speedKt: 156, heading: 130, position: [-93.3, 44.93] });
  assert.equal(routeFits(p, DAY, ATL), false);
  // 10 km northwest of MSP, low and descending: evidently arriving.
  assert.equal(describePlane(p, { airline: "Delta Air Lines", flightNumber: "DL2724", origin: DAY, destination: ATL }).title,
    "Delta flight 2724, approaching Minneapolis–Saint Paul.");
});

test("accepts a high overflight in cruise pointed at its destination", () => {
  const SEA_ORD = { o: SEA, d: { iata: "ORD", icao: "KORD", place: "Chicago O'Hare", lat: 41.9786, lon: -87.9048 } };
  const p = plane({ altFt: 37_000, verticalFpm: 0, heading: 118, position: [-93.4, 45.1] });
  assert.ok(routeFits(p, SEA_ORD.o, SEA_ORD.d));
  assert.equal(routeFits({ ...p, altFt: 12_000 }, SEA_ORD.o, SEA_ORD.d), false, "too low to be passing over");
});

test("arrivals: descending near the destination", () => {
  const p = plane({ position: [-93.35, 44.95], altFt: 4_200, verticalFpm: -900, heading: 120, speedKt: 180 });
  assert.ok(routeFits(p, ATL, MSP));
  const d = describePlane(p, { airline: "Delta Air Lines", flightNumber: "DL1", origin: ATL, destination: MSP });
  assert.equal(d.title, "Delta flight 1 from Atlanta to Minneapolis–Saint Paul.");
  assert.equal(d.detail, "A Boeing 737-900, descending through 4,200 feet at 205 mph.");
});

test("falls back to the callsign's airline when the lookup has nothing", () => {
  const d = describePlane(plane({ callsign: "SKW3810", type: "E75L", verticalFpm: 0, altFt: 36_000 }));
  assert.equal(d.title, "SkyWest flight 3810.");
  assert.equal(d.detail, "An Embraer 175, cruising at 36,000 feet at 485 mph.");
});

test("private planes read as the aircraft itself", () => {
  const d = describePlane(plane({ callsign: "N191DB", registration: "N191DB", type: "P46T", altFt: 2_800, verticalFpm: 0, speedKt: 160 }));
  assert.equal(d.title, "A Piper Malibu Meridian (N191DB).");
  assert.equal(d.detail, "Cruising at 2,800 feet at 185 mph.");
  assert.equal(d.meta, "N191DB · updated just now");
});

test("says what a plane is evidently doing at MSP when no route is known", () => {
  const climbing = describePlane(plane({ position: [-93.15, 44.92], altFt: 3_000, verticalFpm: 2_000 }), { airline: "Delta Air Lines", flightNumber: "DL5" });
  assert.equal(climbing.title, "Delta flight 5, departing Minneapolis–Saint Paul.");
  const parked = describePlane(plane({ position: [-93.21, 44.88], onGround: true, altFt: 0, speedKt: 0 }), { airline: "Delta Air Lines", flightNumber: "DL5" });
  assert.equal(parked.title, "Delta flight 5, at Minneapolis–Saint Paul airport.");
  const faraway = describePlane(plane({ position: [-93.9, 45.2], altFt: 3_000, verticalFpm: -800 }), { airline: "Delta Air Lines", flightNumber: "DL5" });
  assert.equal(faraway.title, "Delta flight 5.", "too far from MSP to say");
});

test("planes on the ground", () => {
  const parked = describePlane(plane({ onGround: true, altFt: 0, speedKt: 0 }), { airline: "Delta Air Lines", flightNumber: "DL9" });
  assert.equal(parked.detail, "A Boeing 737-900, on the ground.");
  const taxi = describePlane(plane({ onGround: true, altFt: 0, speedKt: 14 }), { airline: "Delta Air Lines", flightNumber: "DL9" });
  assert.equal(taxi.detail, "A Boeing 737-900, taxiing at 15 mph.");
});

test("unknown types use the lookup's manufacturer and model", () => {
  const d = describePlane(plane({ callsign: "N5X", registration: "N5X", type: "ZZZZ", verticalFpm: 0 }), { manufacturer: "Acme", model: "Skyrocket" });
  assert.equal(d.title, "An Acme Skyrocket (N5X).");
});
