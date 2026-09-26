/**
 * Cloudflare Pages Function: GET /api/flight?callsign=DAL2437&hex=ab92c4
 *
 * Airline, route and aircraft details from adsbdb.com (free, no key),
 * for plain-language plane tooltips. Routes and airframes don't change
 * mid-flight, so answers are cached for hours.
 */
import type { Airport, FlightInfo } from "../../src/describe.ts";

const CACHE_S = 6 * 3600;

/** Airports whose municipality alone would read oddly. */
const PLACE_NAMES: Record<string, string> = {
  KMSP: "Minneapolis–Saint Paul",
  KSTP: "Saint Paul Downtown Airport",
  KFCM: "Flying Cloud Airport",
  KANE: "Anoka County Airport",
  KMIC: "Crystal Airport",
  KDFW: "Dallas–Fort Worth",
  KEWR: "Newark",
  KJFK: "New York JFK",
  KLGA: "New York LaGuardia",
  KORD: "Chicago O'Hare",
  KMDW: "Chicago Midway",
  KDCA: "Washington National",
  KIAD: "Washington Dulles",
};

interface AdsbdbAirport {
  iata_code?: string; icao_code?: string; municipality?: string; name?: string; latitude?: number; longitude?: number;
}

function airport(a: AdsbdbAirport | undefined): Airport | undefined {
  if (!a || typeof a.latitude !== "number" || typeof a.longitude !== "number") return undefined;
  const icao = a.icao_code ?? "";
  return {
    iata: a.iata_code ?? "", icao,
    place: PLACE_NAMES[icao] ?? a.municipality ?? a.name ?? icao,
    lat: a.latitude, lon: a.longitude,
  };
}

async function adsbdb(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const res = await fetch(`https://api.adsbdb.com/v0/${path}`, {
      headers: { "user-agent": "minneapolis-from-above (+https://minneapolis-from-above.pages.dev)" },
      cf: { cacheTtl: CACHE_S, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { response?: unknown };
    return typeof body.response === "object" && body.response ? (body.response as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export async function lookupFlight(callsign: string, hex: string): Promise<FlightInfo> {
  const [route, craft] = await Promise.all([
    callsign ? adsbdb(`callsign/${callsign}`) : undefined,
    hex ? adsbdb(`aircraft/${hex}`) : undefined,
  ]);
  const info: FlightInfo = {};
  const fr = route?.flightroute as
    | { callsign_iata?: string; airline?: { name?: string }; origin?: AdsbdbAirport; destination?: AdsbdbAirport }
    | undefined;
  if (fr) {
    if (fr.airline?.name) info.airline = fr.airline.name;
    if (fr.callsign_iata) info.flightNumber = fr.callsign_iata;
    info.origin = airport(fr.origin);
    info.destination = airport(fr.destination);
  }
  const ac = craft?.aircraft as { manufacturer?: string; type?: string; registered_owner?: string } | undefined;
  if (ac) {
    if (ac.manufacturer) info.manufacturer = ac.manufacturer;
    if (ac.type) info.model = ac.type;
    if (ac.registered_owner) info.owner = ac.registered_owner;
  }
  return info;
}

export const onRequestGet = async ({ request }: { request: Request }): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const callsign = (params.get("callsign") ?? "").trim().toUpperCase();
  const hex = (params.get("hex") ?? "").trim().toLowerCase();
  // Both go into upstream URL paths: allow only what real ones look like.
  if ((callsign && !/^[A-Z0-9]{2,8}$/.test(callsign)) || (hex && !/^[0-9a-f]{6}$/.test(hex)) || (!callsign && !hex)) {
    return new Response(JSON.stringify({ error: "Pass a callsign (letters and digits) and/or a 6-digit hex code." }), {
      status: 400, headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const info = await lookupFlight(callsign, hex);
  return new Response(JSON.stringify(info), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_S / 6}` },
  });
};
