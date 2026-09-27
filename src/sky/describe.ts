/**
 * A satellite, told in plain words: what it is, who runs it and why, when
 * and where it launched, its orbit, where it is now, and whether you could
 * see it by looking up.
 */
import type { Description } from "../describe.ts";
import type { Kind, SatPosition } from "./orbits.ts";

/** CelesTrak catalog record (a trimmed SATCAT row). */
export interface SatcatRecord {
  OBJECT_ID?: string;
  OBJECT_TYPE?: string;
  OWNER?: string;
  LAUNCH_DATE?: string;
  LAUNCH_SITE?: string;
  PERIOD?: number;
  INCLINATION?: number;
  APOGEE?: number;
  PERIGEE?: number;
  RCS?: number | null;
}

/** Union of Concerned Scientists row: country, operator, users, purpose, detail, mass kg, contractor, vehicle. */
export type UcsRow = [string, string, string, string, string, number | null, string, string];

/** CelesTrak owner codes, in words. */
export const OWNERS: Record<string, string> = {
  US: "the United States", PRC: "China", CIS: "Russia", ISS: "the International Space Station partners",
  ESA: "the European Space Agency", JPN: "Japan", IND: "India", FR: "France", UK: "the United Kingdom", GER: "Germany",
  IT: "Italy", CA: "Canada", ISRA: "Israel", SKOR: "South Korea", NKOR: "North Korea", IRAN: "Iran", BRAZ: "Brazil",
  ARGN: "Argentina", AUS: "Australia", TURK: "Türkiye", UAE: "the United Arab Emirates", SAUD: "Saudi Arabia",
  SPN: "Spain", NOR: "Norway", SWED: "Sweden", FIN: "Finland", NETH: "the Netherlands", BEL: "Belgium",
  SWTZ: "Switzerland", DEN: "Denmark", POL: "Poland", CZE: "the Czech Republic", LTU: "Lithuania", EST: "Estonia",
  GREC: "Greece", POR: "Portugal", LUXE: "Luxembourg", AUT: "Austria", SING: "Singapore", THAI: "Thailand",
  INDO: "Indonesia", MALA: "Malaysia", VTNM: "Vietnam", TWN: "Taiwan", PAKI: "Pakistan", BGD: "Bangladesh",
  EGYP: "Egypt", NIG: "Nigeria", KEN: "Kenya", RWA: "Rwanda", KAZ: "Kazakhstan", UKR: "Ukraine", BELA: "Belarus",
  AZER: "Azerbaijan", CHLE: "Chile", MEX: "Mexico", PERU: "Peru", NZ: "New Zealand", QAT: "Qatar",
  ITSO: "Intelsat", SES: "SES", GLOB: "Globalstar", ORB: "Orbcomm", IRID: "Iridium", O3B: "O3b Networks",
  EUTE: "Eutelsat", EUME: "EUMETSAT", AB: "Arabsat", AC: "AsiaSat", NATO: "NATO", FGER: "France and Germany",
};

/** CelesTrak launch site codes, in words. */
export const SITES: Record<string, string> = {
  AFETR: "Cape Canaveral, Florida", AFWTR: "Vandenberg, California", WLPIS: "Wallops Island, Virginia",
  KODAK: "Kodiak, Alaska", KWAJ: "Kwajalein Atoll", ERAS: "an airplane off Florida", WRAS: "an airplane off California",
  TYMSC: "Baikonur, Kazakhstan", PKMTR: "Plesetsk, Russia", VOSTO: "Vostochny, Russia", KYMSC: "Kapustin Yar, Russia",
  DLS: "Dombarovsky, Russia", SVOBO: "Svobodny, Russia", JSC: "Jiuquan, China", XSC: "Xichang, China",
  TSC: "Taiyuan, China", WSC: "Wenchang, China", YSLA: "a ship in the Yellow Sea", SRILR: "Sriharikota, India",
  FRGUI: "Kourou, French Guiana", KSCUT: "Tanegashima, Japan", USC: "Uchinoura, Japan", RLLB: "Mahia, New Zealand",
  NSC: "Naro, South Korea", YAVNE: "Palmachim, Israel", SEMLS: "Semnan, Iran", SMTS: "Shahrud, Iran",
  SEAL: "a sea launch platform in the Pacific", WOMRA: "Woomera, Australia", SNMLP: "the San Marco platform, Kenya",
};

const COUNTRY_WORDS: Record<string, string> = {
  USA: "the United States", "United States": "the United States", China: "China", Russia: "Russia", UK: "the United Kingdom",
  Multinational: "several countries", ESA: "the European Space Agency",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1998-11-20" -> "November 20, 1998". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : iso;
}

const COMPASS = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
const toward = (az: number) => COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

/** Names people recognize for a few famous objects; everything else as catalogued, tidied. */
export function satName(name: string, id: number): string {
  if (id === 25544) return "International Space Station";
  if (id === 20580) return "Hubble Space Telescope";
  if (/^CSS \(TIANHE\)/.test(name)) return "Tiangong space station";
  const tidy = name.replace(/\s+/g, " ").trim();
  return /^STARLINK/.test(tidy) ? tidy.replace(/^STARLINK/, "Starlink") : tidy;
}

/** "Communications" -> "communications", "Navigation/Global Positioning" -> "navigation", ... */
function purposeWords(purpose: string): string {
  const p = purpose.toLowerCase();
  if (/navigation|positioning/.test(p)) return "navigation";
  if (/earth observation|earth science/.test(p)) return "Earth observation";
  if (/communications/.test(p)) return "communications";
  if (/space science/.test(p)) return "space science";
  if (/technology/.test(p)) return "technology testing";
  if (/surveillance|signals|early warning/.test(p)) return "surveillance";
  return p || "various purposes";
}

/** "Government/Commercial" -> "government and commercial". */
function usersWords(users: string): string {
  const parts = users.split("/").map((u) => u.trim().toLowerCase()).filter(Boolean);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** "National Aeronautics and Space Administration (NASA)/Multinational" -> "NASA and international partners". */
export function operatorWords(op: string): string {
  let o = op.trim();
  const multinational = /\/Multinational$/i.test(o);
  o = o.replace(/\/Multinational$/i, "");
  // Prefer a short acronym in parentheses: "(NASA)".
  const acro = /\(([A-Z][A-Za-z0-9&-]{1,7})\)/.exec(o);
  if (acro) o = acro[1];
  o = o.replace(/\s*\([^)]*\)/g, "").trim();
  if (/^DoD\b|^US (Air Force|Navy|Army|Space Force)|National Reconnaissance Office/i.test(o)) o = "the US military";
  return multinational ? `${o} and international partners` : o;
}

/** Where each tracked debris cloud came from. */
const DEBRIS_STORIES: [RegExp, string, string][] = [
  [/^FENGYUN 1C/, "Fengyun-1C",
    "a Chinese weather satellite that China destroyed with a missile in a January 2007 anti-satellite test, creating the largest debris cloud in history."],
  [/^COSMOS 2251/, "Cosmos 2251",
    "a dead Russian military satellite that collided with the working Iridium 33 in February 2009, the first accidental collision between two satellites."],
  [/^IRIDIUM 33/, "Iridium 33",
    "an Iridium communications satellite destroyed when a dead Russian satellite, Cosmos 2251, hit it in February 2009, the first accidental collision between two satellites."],
  [/^COSMOS 1408/, "Cosmos 1408",
    "a dead Soviet spy satellite that Russia destroyed with a missile in a November 2021 anti-satellite test, forcing the ISS crew to shelter."],
];

/** What well-known satellite families are for, when the UCS database has no entry. */
const FAMILIES: [RegExp, string][] = [
  [/^STARLINK/, "A SpaceX Starlink internet satellite, from the United States."],
  [/^ONEWEB/, "A OneWeb internet satellite, from the United Kingdom."],
  [/^KUIPER/, "An Amazon Project Kuiper internet satellite, from the United States."],
  [/^IRIDIUM/, "An Iridium communications satellite, from the United States."],
  [/^GLOBALSTAR/, "A Globalstar communications satellite, from the United States."],
  [/^ORBCOMM/, "An Orbcomm messaging satellite, from the United States."],
  [/^(NAVSTAR|GPS)/, "A GPS navigation satellite, run by the US military."],
  [/^COSMOS 2\d{3} \(GLONASS|^GLONASS/, "A GLONASS navigation satellite, from Russia."],
  [/^BEIDOU/, "A BeiDou navigation satellite, from China."],
  [/^GSAT0\d{3}|^GALILEO/, "A Galileo navigation satellite, from the European Union."],
  [/^METEOR/, "A Meteor weather satellite, from Russia."],
  [/^NOAA \d/, "A NOAA weather satellite, from the United States."],
  [/^GOES/, "A GOES weather satellite, from the United States."],
  [/^(FENGYUN|FY-)/, "A Fengyun weather satellite, from China."],
  [/^(METOP|METEOSAT)/, "A European weather satellite (EUMETSAT)."],
  [/^JILIN/, "A Jilin Earth-imaging satellite, from China."],
  [/^(FLOCK|DOVE|SKYSAT)/, "A Planet Earth-imaging satellite, from the United States."],
  [/^LANDSAT/, "A Landsat Earth-observing satellite (NASA and USGS)."],
  [/^SENTINEL/, "A Sentinel Earth-observing satellite (European Copernicus program)."],
];

const miles = (km: number) => Math.round(km * 0.621371);
const mph = (kms: number) => Math.round((kms * 2236.94) / 100) * 100;

function orbitSentence(c: SatcatRecord): string | undefined {
  if (!c.PERIOD || !c.APOGEE) return undefined;
  const kind = c.APOGEE < 2000 ? "Low Earth orbit" : c.PERIGEE && c.PERIGEE > 34_000 && c.APOGEE < 37_000 ? "Geostationary orbit" : c.APOGEE > 30_000 && (c.PERIGEE ?? 0) < 2000 ? "A long, looping orbit" : "Medium Earth orbit";
  const every = c.PERIOD < 180 ? `${Math.round(c.PERIOD)} minutes` : `${Math.round((c.PERIOD / 60) * 10) / 10} hours`;
  const tilt = c.INCLINATION !== undefined ? `, tilted ${Math.round(c.INCLINATION * 10) / 10}° to the equator` : "";
  return `${kind}: circles the planet every ${every}${tilt}.`;
}

function radarSize(rcs: number | null | undefined): string | undefined {
  if (rcs === null || rcs === undefined) return undefined;
  return rcs < 0.1 ? "small" : rcs < 1 ? "medium" : "large";
}

/** Rocket family names, tidied from their catalog designators (e.g. "CZ-4C R/B" -> Long March 4). */
const ROCKET_WORDS: [RegExp, string][] = [
  [/^FALCON 9/, "Falcon 9"], [/^FALCON/, "Falcon"],
  [/^CZ-?2/, "Long March 2"], [/^CZ-?3/, "Long March 3"], [/^CZ-?4/, "Long March 4"],
  [/^CZ-?5/, "Long March 5"], [/^CZ-?6/, "Long March 6"], [/^CZ-?7/, "Long March 7"],
  [/^CZ-?8/, "Long March 8"], [/^CZ-?11/, "Long March 11"],
  [/^SL-4\b|^SOYUZ/, "Soyuz"], [/^SL-12\b|^PROTON/, "Proton"], [/^SL-14\b|^SL-16\b|^ZENIT/, "Zenit"],
  [/^ARIANE/, "Ariane"], [/^ATLAS/, "Atlas"], [/^DELTA/, "Delta"], [/^MINOTAUR/, "Minotaur"],
  [/^ELECTRON/, "Electron"], [/^H-?2A|^H-?IIA/, "H-IIA"], [/^H-?2B|^H-?IIB/, "H-IIB"],
  [/^PSLV/, "PSLV"], [/^GSLV/, "GSLV"], [/^VEGA/, "Vega"],
];

/** "FALCON 9 R/B" -> "Falcon 9"; anything unrecognized keeps its catalog name, tidied. */
function rocketName(name: string): string {
  const tidy = name.replace(/\s*R\/B.*/i, "").trim();
  const found = ROCKET_WORDS.find(([re]) => re.test(tidy));
  return found ? found[1] : tidy.replace(/\s+/g, " ");
}

type OrbitClass = "geo" | "sunsync" | "molniya" | "leo";

/** A rough orbit family from raw catalog numbers, for the purpose guess below. */
function classifyOrbit(c: SatcatRecord): OrbitClass | undefined {
  if (c.APOGEE === undefined || c.PERIGEE === undefined) return undefined;
  const { APOGEE: apogee, PERIGEE: perigee } = c;
  const incl = c.INCLINATION ?? 0;
  if (apogee > 33_000 && perigee > 33_000) return "geo";
  if (apogee - perigee > 15_000 && incl > 55 && incl < 70) return "molniya";
  if (apogee < 1_500 && incl > 95 && incl < 102) return "sunsync";
  if (apogee < 2_000) return "leo";
  return undefined;
}

/**
 * When neither the UCS database nor a well-known name family says what a
 * satellite is for, its orbit still tells a story: amateur satellite
 * trackers read these patterns the same way. Always hedged as a guess,
 * never stated as confirmed.
 */
function guessPurpose(c: SatcatRecord): string | undefined {
  switch (classifyOrbit(c)) {
    case "geo":
      return "Satellite trackers note that a geostationary orbit like this is typically used for communications, weather-watching, or military relay.";
    case "sunsync":
      return "Its sun-synchronous, low orbit is the pattern trackers associate with Earth-imaging or reconnaissance satellites.";
    case "molniya":
      return "Its highly elliptical orbit, lingering for hours over the far north, is the pattern used by missile-warning and high-latitude communications satellites.";
    case "leo":
      return "Satellites in this kind of low orbit are typically used for communications, navigation or scientific research; its precise mission isn't publicly documented.";
    default:
      return undefined;
  }
}

export function describeSatellite(opts: {
  id: number;
  name: string;
  kind: Kind;
  live: SatPosition;
  sunElevation: number;
  catalog?: SatcatRecord;
  ucs?: UcsRow;
}): Description {
  const { id, kind, live, catalog: c, ucs: u } = opts;
  const sentences: string[] = [];

  // Debris: where it came from.
  if (kind === "debris") {
    const story = DEBRIS_STORIES.find(([re]) => re.test(opts.name.trim()));
    const parent = story?.[1] ?? opts.name.replace(/\s*DEB\b.*/, "").trim();
    const isFragment = /\bDEB\b/.test(opts.name);
    const title = isFragment ? `A fragment of ${parent}.` : `What remains of ${parent}.`;
    const detail = [
      story ? `Space debris from ${story[2]}` : "Tracked space debris.",
      orbitSentence(c ?? {}),
      `Now ${miles(live.altKm).toLocaleString("en-US")} miles up, moving at ${mph(live.speedKms).toLocaleString("en-US")} mph.`,
      isFragment ? "Far too small to see with the eye." : undefined,
    ].filter(Boolean).join(" ");
    const meta = [`NORAD ${id}`, c?.OBJECT_ID, radarSize(c?.RCS) && `radar size ${radarSize(c?.RCS)}`].filter(Boolean).join(" · ");
    return { title, detail, meta };
  }

  // Rocket bodies: the spent stage that delivered a payload, not a payload
  // itself. Kept distinct from both debris and working satellites.
  if (c?.OBJECT_TYPE === "R/B") {
    const title = `${rocketName(opts.name)} rocket stage.`;
    const detail = [
      "A spent rocket stage, still coasting in the orbit it delivered its payload to.",
      orbitSentence(c),
      `Now ${miles(live.altKm).toLocaleString("en-US")} miles up, moving at ${mph(live.speedKms).toLocaleString("en-US")} mph.`,
    ].filter(Boolean).join(" ");
    const meta = [`NORAD ${id}`, c.OBJECT_ID, radarSize(c.RCS) && `radar size ${radarSize(c.RCS)}`].filter(Boolean).join(" · ");
    return { title, detail, meta };
  }

  // What it is and who runs it.
  const family = FAMILIES.find(([re]) => re.test(opts.name.trim()));
  if (kind === "iss") {
    sentences.push("A crewed laboratory, home to astronauts since 2000, run by NASA, Roscosmos, ESA, JAXA and the Canadian Space Agency.");
  } else if (kind === "station") {
    sentences.push("China's crewed space station, home to taikonauts, run by the China Manned Space Agency.");
  } else if (u && (u[1] || u[3])) {
    const users = usersWords(u[2]);
    const operator = operatorWords(u[1]);
    let who = operator ? `Operated by ${operator}` : "Operated";
    who += ` for ${users ? `${users} ` : ""}${purposeWords(u[3])}`;
    const from = COUNTRY_WORDS[u[0]] ?? u[0];
    sentences.push(`${who}${from ? `, from ${from}` : ""}.`);
  } else if (family) {
    sentences.push(family[1]);
  } else if (c && c.OWNER) {
    sentences.push(`A satellite from ${OWNERS[c.OWNER] ?? c.OWNER}.`);
    const guess = guessPurpose(c);
    if (guess) sentences.push(guess);
  }

  // Launch.
  if (c?.LAUNCH_DATE) {
    const site = c.LAUNCH_SITE ? ` from ${SITES[c.LAUNCH_SITE] ?? c.LAUNCH_SITE}` : "";
    const vehicle = u?.[7] ? ` on a ${u[7]}` : "";
    sentences.push(`Launched ${longDate(c.LAUNCH_DATE)}${site}${vehicle}.`);
  }

  // Orbit, then where it is right now.
  const orbit = c && orbitSentence(c);
  if (orbit) sentences.push(orbit);
  sentences.push(`Now ${miles(live.altKm).toLocaleString("en-US")} miles up, moving at ${mph(live.speedKms).toLocaleString("en-US")} mph.`);

  // Could you see it?
  if (live.elevation < 10) sentences.push("Too low in the sky to see from here right now.");
  else if (live.eclipsed) sentences.push("In Earth's shadow, so not visible right now.");
  else if (opts.sunElevation > -6) sentences.push("Sunlit, but the sky here is too bright to see it.");
  else sentences.push(`Visible to the eye right now: look ${toward(live.azimuth)}, ${Math.round(live.elevation)}° above the horizon.`);

  const meta = [`NORAD ${id}`, c?.OBJECT_ID, radarSize(c?.RCS) && `radar size ${radarSize(c?.RCS)}`, u?.[5] && `${u[5].toLocaleString("en-US")} kg at launch`]
    .filter(Boolean).join(" · ");
  return { title: `${satName(opts.name, id)}.`, detail: sentences.join(" "), meta };
}
