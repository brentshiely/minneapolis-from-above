/**
 * Turns transit and flight data into plain-language sentences for tooltips.
 * Everything here is pure so it can be tested without a map.
 */
import type { RouteInfo, Shape } from "./transit/data.ts";

export interface Description {
  /** The headline: what it is and where it's going. */
  title: string;
  /** A second sentence: how it's moving. */
  detail?: string;
  /** Small print: ids and data freshness. */
  meta: string;
  /** A live snapshot to show above the text, if there is one. */
  image?: string;
}

// --- shared -----------------------------------------------------------------

export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m === 1 ? "a minute ago" : `${m} minutes ago`;
}

const COMPASS: Record<string, string> = { NB: "north", SB: "south", EB: "east", WB: "west" };

/** Metro Transit sign abbreviations, spelled out. */
const SIGN_WORDS: [RegExp, string][] = [
  [/\b(Mpls)\b\.?/g, "Minneapolis"],
  [/\bSt\.? Paul\b/g, "Saint Paul"],
  [/\b(Dtwn|Dwtn)\b\.?/g, "Downtown"],
  [/\bTC\b|\bTc\b/g, "Transit Center"],
  [/\bSta\b\.?/g, "Station"],
  [/\bUniv\b\.?/g, "University"],
  [/\bCtr\b\.?/g, "Center"],
  [/\bBrklyn\b\.?/g, "Brooklyn"],
  [/\bLk\b\.?/g, "Lake"],
  [/\bVlg\b\.?/g, "Village"],
  [/\bP&R\b|\bPR\b/g, "Park & Ride"],
  [/\bAv\b\.?/g, "Ave"],
  [/\bPk\b\.?/g, "Park"],
  [/\bMplwd\b\.?/g, "Maplewood"],
  [/\bRsvl\b\.?/g, "Roseville"],
  [/\bHgts\b\.?/g, "Heights"],
  [/\bRpds\b\.?/g, "Rapids"],
  [/\bHosp\b\.?/g, "Hospital"],
  [/\bMed\b\.?/g, "Medical"],
  [/\bMOA\b|\bMall Amer\b/g, "Mall of America"],
  [/\bCo Rd\b/g, "County Road"],
  // "46St" -> "46th St", "53Ave" -> "53rd Ave"
  [/\b(\d+) ?(St|Ave)\b/g, "\u0000$1\u0000$2"],
  [/\s+-\s+/g, " – "],
];

function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

export function spellOut(sign: string): string {
  let out = sign.trim();
  for (const [re, word] of SIGN_WORDS) out = out.replace(re, word);
  return out.replace(/\u0000(\d+)\u0000(St|Ave)/g, (_, n, w) => `${ordinal(Number(n))} ${w}`);
}

const DOWNTOWN = /^(Downtown|Dtwn|Dwtn)\b/i;

/**
 * Read a destination sign the way a rider would. Signs come as
 * "Corridor / Destination" ("Selby-Lake / Lake & France") or
 * "Destination / Area / Via Street" ("Dwtn Mpls / North Loop / Via Maryland").
 * Returns the route's corridor name, where it's going, and the street it
 * takes when the sign says.
 */
export function parseSign(sign: string): { corridor?: string; to: string; via?: string; service?: "express" | "limited-stop" } {
  let service: "express" | "limited-stop" | undefined;
  const parts = sign
    // Light rail and BRT signs lead with the line color: "RED Mall of America".
    .replace(/^(RED|ORANGE|GREEN|BLUE|GOLD)\s+/, "")
    .split(" / ")
    .map((p) => p.trim())
    .filter((p) => {
      if (/^Express$/i.test(p)) { service = "express"; return false; }
      if (/^Ltd Stop$/i.test(p)) { service = "limited-stop"; return false; }
      // Run labels and bare directions aren't places.
      return p && !/^Trip \d+$/i.test(p) && !/^(Reserve|(North|South|East|West)bound)$/i.test(p);
    });
  const viaPart = parts.find((p) => /^Via\s/i.test(p));
  const rest = parts.filter((p) => p !== viaPart);
  const via = viaPart ? spellOut(viaPart.replace(/^Via\s+/i, "")) : undefined;
  let corridor: string | undefined;
  let dest: string[];
  if (rest.length >= 2 && !DOWNTOWN.test(rest[0])) {
    corridor = rest[0];
    dest = rest.slice(1);
  } else {
    dest = rest;
  }
  const to = dest.map((d) => spellOut(d.replace(/^To\s+/i, ""))).join(", ");
  return { ...(corridor && { corridor: spellOut(corridor) }), to, ...(via && { via }), ...(service && { service }) };
}

// --- buses and trains -------------------------------------------------------

export function describeVehicle(opts: {
  routeId: string;
  route?: RouteInfo;
  shape?: Shape;
  vehicleId: string;
  ageS: number;
}): Description {
  const { route, shape } = opts;
  const mode = route?.mode ?? "bus";
  const noun = mode === "rail" ? "train" : "bus";
  const sign = shape ? parseSign(shape.headsign) : undefined;
  const heading = shape ? COMPASS[shape.direction] : undefined;

  let name: string;
  if (mode === "bus") {
    const corridor = sign?.corridor ? ` (${sign.corridor})` : "";
    const service = sign?.service ? ` ${sign.service}` : "";
    name = `Route ${route?.name ?? opts.routeId}${corridor}${service} bus`;
  } else {
    // "METRO Blue Line train", "METRO A Line bus"
    name = `METRO ${route?.name ?? opts.routeId} ${noun}`;
  }
  // Some routes sign their own name ("Airport Shuttle"); that's not a destination.
  const signsOwnName = !!sign?.to && [route?.name, route?.long].some((n) => n && n.toLowerCase().includes(sign.to.toLowerCase()));
  const to = sign?.to && !signsOwnName ? ` to ${sign.to}` : "";
  const via = sign?.via ? `, via ${sign.via}` : "";
  const title = `${name}${to}${via}`;
  const detail = heading ? `Heading ${heading}.` : undefined;
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  return { title, detail, meta: `${Noun} ${opts.vehicleId} · updated ${ago(opts.ageS)}` };
}

// --- planes -----------------------------------------------------------------

/** Common ICAO type designators over the Twin Cities, in words. */
export const AIRCRAFT_TYPES: Record<string, string> = {
  A19N: "Airbus A319neo", A20N: "Airbus A320neo", A21N: "Airbus A321neo",
  A319: "Airbus A319", A320: "Airbus A320", A321: "Airbus A321",
  A332: "Airbus A330-200", A333: "Airbus A330-300", A339: "Airbus A330-900",
  A359: "Airbus A350-900", BCS1: "Airbus A220-100", BCS3: "Airbus A220-300",
  B712: "Boeing 717", B737: "Boeing 737-700", B738: "Boeing 737-800", B739: "Boeing 737-900",
  B37M: "Boeing 737 MAX 7", B38M: "Boeing 737 MAX 8", B39M: "Boeing 737 MAX 9", B3XM: "Boeing 737 MAX 10",
  B752: "Boeing 757-200", B753: "Boeing 757-300", B762: "Boeing 767-200", B763: "Boeing 767-300",
  B764: "Boeing 767-400", B772: "Boeing 777-200", B77W: "Boeing 777-300ER", B77L: "Boeing 777 freighter",
  B788: "Boeing 787-8", B789: "Boeing 787-9", B78X: "Boeing 787-10", B744: "Boeing 747-400",
  B748: "Boeing 747-8", MD11: "McDonnell Douglas MD-11", A306: "Airbus A300",
  CRJ2: "Bombardier CRJ200", CRJ7: "Bombardier CRJ700", CRJ9: "Bombardier CRJ900",
  E135: "Embraer ERJ-135", E145: "Embraer ERJ-145", E170: "Embraer 170", E75L: "Embraer 175",
  E75S: "Embraer 175", E190: "Embraer 190", E195: "Embraer 195", E290: "Embraer E190-E2",
  DH8D: "De Havilland Dash 8-400", AT76: "ATR 72-600",
  C130: "Lockheed C-130 Hercules", C30J: "Lockheed C-130J Super Hercules", K35R: "Boeing KC-135 Stratotanker",
  C17: "Boeing C-17 Globemaster III",
  C150: "Cessna 150", C152: "Cessna 152", C172: "Cessna 172 Skyhawk", C182: "Cessna 182 Skylane",
  C206: "Cessna 206", C208: "Cessna Caravan", C210: "Cessna 210 Centurion", C310: "Cessna 310",
  C25A: "Cessna Citation CJ2", C25B: "Cessna Citation CJ3", C25C: "Cessna Citation CJ4",
  C510: "Cessna Citation Mustang", C525: "Cessna CitationJet", C560: "Cessna Citation V",
  C56X: "Cessna Citation Excel", C68A: "Cessna Citation Latitude", C700: "Cessna Citation Longitude",
  SR20: "Cirrus SR20", SR22: "Cirrus SR22", S22T: "Cirrus SR22T", SF50: "Cirrus Vision Jet",
  PA28: "Piper Cherokee", P28A: "Piper Cherokee", P28R: "Piper Arrow", PA32: "Piper Saratoga",
  PA34: "Piper Seneca", PA44: "Piper Seminole", PA46: "Piper Malibu", P46T: "Piper Malibu Meridian",
  M20P: "Mooney M20", BE33: "Beechcraft Bonanza", BE35: "Beechcraft Bonanza", BE36: "Beechcraft Bonanza",
  BE58: "Beechcraft Baron", BE20: "Beechcraft King Air 200", BE9L: "Beechcraft King Air 90",
  B350: "Beechcraft King Air 350", PC12: "Pilatus PC-12", PC24: "Pilatus PC-24", TBM9: "Daher TBM 900",
  TBM8: "Daher TBM 850", TBM7: "Daher TBM 700", DA40: "Diamond DA40", DA42: "Diamond DA42",
  CL30: "Bombardier Challenger 300", CL35: "Bombardier Challenger 350", CL60: "Bombardier Challenger 600",
  GLEX: "Bombardier Global Express", GL5T: "Bombardier Global 5000", GLF4: "Gulfstream IV",
  GLF5: "Gulfstream V", GLF6: "Gulfstream G650", G280: "Gulfstream G280", LJ45: "Learjet 45",
  LJ60: "Learjet 60", E55P: "Embraer Phenom 300", E50P: "Embraer Phenom 100", E545: "Embraer Praetor 500",
  HDJT: "HondaJet", FA50: "Dassault Falcon 50", F900: "Dassault Falcon 900", F2TH: "Dassault Falcon 2000",
  EC35: "Airbus EC135 helicopter", EC45: "Airbus EC145 helicopter", AS50: "Airbus AS350 helicopter",
  R44: "Robinson R44 helicopter", R22: "Robinson R22 helicopter", B06: "Bell 206 helicopter",
  B407: "Bell 407 helicopter", A109: "Leonardo AW109 helicopter", S76: "Sikorsky S-76 helicopter",
  H60: "Sikorsky Black Hawk helicopter", AS65: "Airbus Dauphin helicopter",
};

/** Airlines by ICAO callsign prefix, for when the route lookup has nothing. */
export const AIRLINES: Record<string, string> = {
  DAL: "Delta", SKW: "SkyWest", EDV: "Endeavor Air", UAL: "United", AAL: "American", SWA: "Southwest",
  SCX: "Sun Country", FFT: "Frontier", NKS: "Spirit", ASA: "Alaska", JBU: "JetBlue", ENY: "Envoy",
  RPA: "Republic", ASH: "Mesa", PDT: "Piedmont", JIA: "PSA", GJS: "GoJet", AWI: "Air Wisconsin",
  FDX: "FedEx", UPS: "UPS", GTI: "Atlas Air", ABX: "ABX Air", ACA: "Air Canada", JZA: "Air Canada Jazz",
  WJA: "WestJet", KLM: "KLM", AFR: "Air France", ICE: "Icelandair", DLH: "Lufthansa", BAW: "British Airways",
  AMX: "Aeroméxico", VOI: "Volaris", AAY: "Allegiant", MXY: "Breeze", CPZ: "Compass", QXE: "Horizon",
  LXJ: "Flexjet", EJA: "NetJets", XOJ: "XO", RCH: "US Air Force", CNV: "US Navy",
};

export interface FlightInfo {
  airline?: string;
  /** e.g. "DL2437" */
  flightNumber?: string;
  origin?: Airport;
  destination?: Airport;
  manufacturer?: string;
  model?: string;
  owner?: string;
  /** ICAO type designator and registration, for feeds that don't send them. */
  icaoType?: string;
  registration?: string;
}

export interface Airport {
  iata: string;
  icao: string;
  /** Plain place name, e.g. "Atlanta". */
  place: string;
  lat: number;
  lon: number;
}

export interface PlaneFacts {
  callsign: string;
  registration: string;
  type: string;
  altFt: number | null;
  onGround: boolean;
  speedKt: number | null;
  verticalFpm: number | null;
  heading: number;
  position: [number, number];
  ageS: number;
}

/** "18,000" for 17,975; "2,800" for 2,780. */
function feet(ft: number): string {
  const r = ft >= 10_000 ? Math.round(ft / 1000) * 1000 : Math.round(ft / 100) * 100;
  return r.toLocaleString("en-US");
}

const mph = (kt: number) => Math.round((kt * 1.15078) / 5) * 5;

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function kmBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** Initial bearing in degrees from a to b. */
function bearingTo(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(toRad(bLon - aLon)) * Math.cos(toRad(bLat));
  const x = Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) - Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(toRad(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Callsign route databases are often stale, so only trust a route when the
 * plane fits it. Over the Twin Cities that means one of two things: it's
 * departing or arriving at an airport nearby, or it's a high overflight in
 * level cruise pointed at its destination.
 */
export function routeFits(p: PlaneFacts, origin: Airport, destination: Airport): boolean {
  const [lon, lat] = p.position;
  const dO = kmBetween(lat, lon, origin.lat, origin.lon);
  const dD = kmBetween(lat, lon, destination.lat, destination.lon);
  const toDest = bearingTo(lat, lon, destination.lat, destination.lon);
  const off = Math.abs(((p.heading - toDest + 540) % 360) - 180);
  const v = p.verticalFpm ?? 0;
  const NEAR_KM = 80;
  if (dO < NEAR_KM && dD < NEAR_KM) return true;                          // a local hop
  if (dD < NEAR_KM) return p.onGround || v <= 300;                         // arriving: not climbing away
  if (dO < NEAR_KM) return p.onGround || (v >= -300 && off < 100);         // departed: not descending in
  const cruising = (p.altFt ?? 0) >= 25_000 && Math.abs(v) < 1_000;
  return !p.onGround && cruising && off < 45;                              // overflight
}

/** "SkyWest" from "SkyWest Airlines", "Delta" from "Delta Air Lines". */
function shortAirline(name: string): string {
  return name.replace(/\s+(Air ?Lines|Airlines|Airways|Aviation|Air Transport|International)$/i, "").trim();
}

/**
 * Every field a small plane in the metro is plausibly using, so a low
 * climb or descent near Saint Paul Downtown isn't reported as MSP just
 * because MSP is the airport everyone's heard of. MSP itself gets a
 * wider net (bigger airport, faster climb-out, airliners cruise higher
 * before leveling off) than the general-aviation fields around it.
 */
const METRO_AIRPORTS = [
  { name: "Minneapolis–Saint Paul", lat: 44.882, lon: -93.2218, radiusKm: 35, maxAltFt: 9_000, groundKm: 4 },
  { name: "Saint Paul Downtown", lat: 44.9344, lon: -93.0599, radiusKm: 15, maxAltFt: 4_000, groundKm: 3 },
  { name: "Flying Cloud", lat: 44.8271, lon: -93.4569, radiusKm: 15, maxAltFt: 4_000, groundKm: 3 },
  { name: "Anoka County–Blaine", lat: 45.145, lon: -93.2119, radiusKm: 15, maxAltFt: 4_000, groundKm: 3 },
  { name: "Crystal", lat: 45.0621, lon: -93.354, radiusKm: 12, maxAltFt: 3_500, groundKm: 3 },
  { name: "South Saint Paul", lat: 44.8577, lon: -93.0499, radiusKm: 12, maxAltFt: 3_500, groundKm: 3 },
  { name: "Airlake", lat: 44.6277, lon: -93.2283, radiusKm: 12, maxAltFt: 3_500, groundKm: 3 },
];

/**
 * When no route is known, what the plane is evidently doing at whichever
 * metro airport it's actually nearest: low and descending nearby is an
 * arrival, low and climbing a departure.
 */
function airportPhase(p: PlaneFacts): string | undefined {
  const [lon, lat] = p.position;
  let nearest = METRO_AIRPORTS[0], bestKm = Infinity;
  for (const a of METRO_AIRPORTS) {
    const km = kmBetween(lat, lon, a.lat, a.lon);
    if (km < bestKm) { bestKm = km; nearest = a; }
  }
  if (p.onGround) return bestKm < nearest.groundKm ? `at ${nearest.name} airport` : undefined;
  if (bestKm > nearest.radiusKm || (p.altFt ?? Infinity) > nearest.maxAltFt) return undefined;
  const v = p.verticalFpm ?? 0;
  if (v < -300) return `approaching ${nearest.name}`;
  if (v > 300) return `departing ${nearest.name}`;
  return undefined;
}

const isPrivateCallsign = (cs: string, reg: string) => !cs || cs === reg || /^N\d/.test(cs);

export function describePlane(facts: PlaneFacts, info?: FlightInfo): Description {
  // Some feeds (OpenSky) omit type and registration; the lookup fills them in.
  const p = { ...facts, type: facts.type || info?.icaoType || "", registration: facts.registration || info?.registration || "" };
  const typeName = AIRCRAFT_TYPES[p.type]
    ?? (info?.manufacturer && info.model ? `${info.manufacturer} ${info.model}` : p.type ? `${p.type} aircraft` : "aircraft");
  const prefix = p.callsign.slice(0, 3);
  const airline = info?.airline ? shortAirline(info.airline) : (!isPrivateCallsign(p.callsign, p.registration) ? AIRLINES[prefix] : undefined);
  const number = (info?.flightNumber ?? p.callsign).replace(/^[A-Z]{2,3}(?=\d)/, "");

  const route = info?.origin && info.destination && routeFits(p, info.origin, info.destination)
    ? ` from ${info.origin.place} to ${info.destination.place}` : "";
  const phase = route ? undefined : airportPhase(p);
  let title: string;
  if (airline) {
    title = `${airline} flight ${number}${route}${phase ? `, ${phase}` : ""}`;
  } else {
    const article = /^[AEIOU]/i.test(typeName) ? "An" : "A";
    title = `${article} ${typeName}${p.registration ? ` (${p.registration})` : ""}${phase ? `, ${phase}` : ""}`;
  }

  let motion: string;
  if (p.onGround) {
    motion = (p.speedKt ?? 0) > 5 ? `taxiing at ${mph(p.speedKt!)} mph` : "on the ground";
  } else if (p.altFt === null) {
    motion = p.speedKt ? `flying at ${mph(p.speedKt)} mph` : "in the air";
  } else {
    const v = p.verticalFpm ?? 0;
    const verb = v > 400 ? "climbing through" : v < -400 ? "descending through" : "cruising at";
    motion = `${verb} ${feet(p.altFt)} feet${p.speedKt ? ` at ${mph(p.speedKt)} mph` : ""}`;
  }
  const detail = airline
    ? `${/^[AEIOU]/i.test(typeName) ? "An" : "A"} ${typeName}, ${motion}.`
    : `${motion[0].toUpperCase()}${motion.slice(1)}.`;

  const ids = [p.callsign && p.callsign !== p.registration ? p.callsign : "", p.registration].filter(Boolean).join(" · ");
  return { title: `${title}.`, detail, meta: `${ids ? `${ids} · ` : ""}updated ${ago(p.ageS)}` };
}
