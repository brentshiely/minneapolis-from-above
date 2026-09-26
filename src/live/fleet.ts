import type { Mode, Transit } from "../transit/data.ts";
import type { VehicleRow } from "./feed.ts";
import { Motion } from "./motion.ts";

export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  mode: Mode;
  motion: Motion;
  /** Where the vehicle is drawn right now: [lon, lat]. */
  position: [number, number];
  /** POSIX seconds of the latest GPS fix. */
  fixTime: number;
  /** Feed time of the latest snapshot that included this vehicle. */
  seenAt: number;
}

/** Every vehicle currently on the map, keyed by vehicle id. */
export class Fleet {
  readonly vehicles = new Map<string, Vehicle>();
  private transit: Transit;

  constructor(transit: Transit) {
    this.transit = transit;
  }

  /** Apply a feed snapshot. Vehicles missing from it are kept until pruned. */
  update(feedTime: number, rows: VehicleRow[]) {
    for (const [id, tripId, routeId, lat, lon, fixTime] of rows) {
      const mode = this.transit.routes[routeId]?.mode ?? "bus";
      const shape = this.transit.shapeForTrip(tripId);
      const v = this.vehicles.get(id);
      if (v) {
        v.motion.onFix(shape, [lon, lat], fixTime);
        Object.assign(v, { tripId, routeId, mode, fixTime, seenAt: feedTime, position: v.motion.pos });
      } else {
        const motion = new Motion(shape, [lon, lat], fixTime);
        this.vehicles.set(id, { id, tripId, routeId, mode, motion, position: motion.pos, fixTime, seenAt: feedTime });
      }
    }
  }

  /** Glide every vehicle forward by `dtS` seconds. */
  advance(dtS: number) {
    for (const v of this.vehicles.values()) {
      v.motion.advance(dtS);
      v.position = v.motion.pos;
    }
  }

  /** Drop vehicles not seen for `maxAgeS` seconds of feed time. */
  prune(feedTime: number, maxAgeS: number) {
    for (const [id, v] of this.vehicles) if (feedTime - v.seenAt > maxAgeS) this.vehicles.delete(id);
  }

  list(): Vehicle[] {
    return [...this.vehicles.values()];
  }
}
