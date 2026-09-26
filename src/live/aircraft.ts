import type { AircraftRow } from "../../functions/api/aircraft.ts";
import { M_PER_DEG_LAT } from "../transit/data.ts";
import type { LonLat } from "./geometry.ts";

export type { AircraftRow };

const KT_TO_MS = 0.514444;
/** Stop extrapolating after this long without a fix; better to wait than wander. */
const MAX_EXTRAPOLATE_S = 30;
/** Position corrections decay with this time constant (seconds). */
const CORRECT_TAU_S = 1.5;
/** Headings ease toward the reported track with this time constant. */
const HEADING_TAU_S = 1;
/** A correction bigger than this is a jump; fade instead of sliding. */
const JUMP_M = 3000;
export const PLANE_FADE_IN_S = 1.5;
/** Planes unheard from this long fade out... */
export const PLANE_STALE_FADE_S = 25;
/** ...and are gone by this long. */
export const PLANE_STALE_S = 45;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface Plane {
  id: string;
  callsign: string;
  type: string;
  registration: string;
  /** Feet; 0 on the ground; null when unknown. */
  altFt: number | null;
  onGround: boolean;
  speedKt: number | null;
  /** Feet per minute; positive is climbing. */
  verticalFpm: number | null;
  /** Drawn position and heading (degrees clockwise from north). */
  position: LonLat;
  heading: number;
  alpha: number;
  /** Page-clock seconds of the latest fix's measurement. */
  fixAt: number;
  seenAt: number;
  appearAt: number;
  // Dead reckoning state.
  fix: LonLat;
  /** Velocity in meters per second, east and north. */
  vE: number;
  vN: number;
  track: number | null;
  /** Correction offset (meters east/north) at `offsetAt`, decaying to zero. */
  offE: number;
  offN: number;
  offsetAt: number;
}

/** Where dead reckoning puts the plane at page time `now`, before corrections. */
function predict(p: Plane, now: number): LonLat {
  const dt = Math.min(MAX_EXTRAPOLATE_S, Math.max(0, now - p.fixAt));
  const kx = M_PER_DEG_LAT * Math.cos((p.fix[1] * Math.PI) / 180);
  return [p.fix[0] + (p.vE * dt) / kx, p.fix[1] + (p.vN * dt) / M_PER_DEG_LAT];
}

function drawnAt(p: Plane, now: number): LonLat {
  const base = predict(p, now);
  const decay = Math.exp(-Math.max(0, now - p.offsetAt) / CORRECT_TAU_S);
  const kx = M_PER_DEG_LAT * Math.cos((base[1] * Math.PI) / 180);
  return [base[0] + (p.offE * decay) / kx, base[1] + (p.offN * decay) / M_PER_DEG_LAT];
}

/** Every aircraft currently over the map, keyed by ICAO hex code. */
export class AirFleet {
  readonly planes = new Map<string, Plane>();

  /** Apply a snapshot received at page time `now`. */
  update(rows: AircraftRow[], now: number) {
    for (const [id, callsign, lat, lon, altFt, gs, track, type, registration, ageS, vfpm] of rows) {
      const fixAt = now - ageS;
      const speed = (gs ?? 0) * KT_TO_MS;
      const rad = ((track ?? 0) * Math.PI) / 180;
      const moving = gs !== null && track !== null;
      const vE = moving ? speed * Math.sin(rad) : 0;
      const vN = moving ? speed * Math.cos(rad) : 0;
      const info = {
        callsign, type, registration, altFt, onGround: altFt === 0, speedKt: gs, verticalFpm: vfpm, track,
      };
      const p = this.planes.get(id);
      if (!p) {
        const plane: Plane = {
          id, ...info, position: [lon, lat], heading: track ?? 0, alpha: 0,
          fixAt, seenAt: now, appearAt: now, fix: [lon, lat], vE, vN, offE: 0, offN: 0, offsetAt: now,
        };
        plane.position = predict(plane, now);
        this.planes.set(id, plane);
        continue;
      }
      if (fixAt <= p.fixAt && lat === p.fix[1] && lon === p.fix[0]) { p.seenAt = now; continue; }
      const before = drawnAt(p, now);
      Object.assign(p, info, { fix: [lon, lat], fixAt, vE, vN, seenAt: now });
      const after = predict(p, now);
      const kx = M_PER_DEG_LAT * Math.cos((after[1] * Math.PI) / 180);
      const offE = (before[0] - after[0]) * kx, offN = (before[1] - after[1]) * M_PER_DEG_LAT;
      if (Math.hypot(offE, offN) > JUMP_M) {
        p.offE = p.offN = 0;
        p.appearAt = now;
      } else {
        p.offE = offE; p.offN = offN;
      }
      p.offsetAt = now;
    }
  }

  /** Update drawn positions, headings and opacity for page time `now`. */
  advance(dtS: number, now: number) {
    const k = 1 - Math.exp(-dtS / HEADING_TAU_S);
    for (const p of this.planes.values()) {
      p.position = drawnAt(p, now);
      if (p.track !== null) {
        const diff = ((p.track - p.heading + 540) % 360) - 180;
        p.heading = (p.heading + diff * k + 360) % 360;
      }
      const fadeIn = clamp01((now - p.appearAt) / PLANE_FADE_IN_S);
      const fresh = 1 - clamp01((now - p.seenAt - PLANE_STALE_FADE_S) / (PLANE_STALE_S - PLANE_STALE_FADE_S));
      p.alpha = fadeIn * fresh;
    }
  }

  prune(now: number) {
    for (const [id, p] of this.planes) if (now - p.seenAt > PLANE_STALE_S) this.planes.delete(id);
  }

  list(): Plane[] {
    return [...this.planes.values()];
  }
}
