import type { Mode, Transit } from "../transit/data.ts";
import type { VehicleRow } from "./feed.ts";

export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  mode: Mode;
  /** Where the vehicle is drawn: [lon, lat]. */
  position: [number, number];
  bearing: number | null;
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
    for (const [id, tripId, routeId, lat, lon, fixTime, bearing] of rows) {
      const mode = this.transit.routes[routeId]?.mode ?? "bus";
      const v = this.vehicles.get(id);
      if (v) {
        Object.assign(v, { tripId, routeId, mode, position: [lon, lat], bearing, fixTime, seenAt: feedTime });
      } else {
        this.vehicles.set(id, { id, tripId, routeId, mode, position: [lon, lat], bearing, fixTime, seenAt: feedTime });
      }
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
