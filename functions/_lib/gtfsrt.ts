/**
 * Minimal GTFS-realtime VehiclePositions decoder.
 *
 * Reads only the fields the map needs, straight from the protobuf wire
 * format. Hand-rolled because the usual protobufjs-based bindings generate
 * code with `new Function`, which Cloudflare Workers forbid.
 * Field numbers: https://gtfs.org/realtime/proto/
 */

export interface VehiclePosition {
  /** Vehicle id (VehicleDescriptor.id, falling back to the entity id). */
  id: string;
  tripId: string;
  routeId: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from north, when reported. */
  bearing?: number;
  /** Meters per second, when reported. */
  speed?: number;
  /** POSIX seconds when this position was measured. */
  timestamp?: number;
}

export interface VehicleFeed {
  /** POSIX seconds when the feed was generated. */
  timestamp?: number;
  vehicles: VehiclePosition[];
}

const VARINT = 0, FIXED64 = 1, LEN = 2, FIXED32 = 5;

class Reader {
  pos: number;
  readonly end: number;
  private buf: Uint8Array;
  private view: DataView;
  private utf8 = new TextDecoder();
  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get done() { return this.pos >= this.end; }
  varint(): number {
    // Values here (timestamps, enums, lengths) fit in 53 bits; use float
    // math past 32 bits instead of BigInt.
    let result = 0, mul = 1, b: number;
    do {
      if (this.pos >= this.end) throw new Error("truncated varint");
      b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return result;
  }
  tag(): [field: number, wire: number] {
    const t = this.varint();
    return [Math.floor(t / 8), t & 7];
  }
  float(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  double(): number { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  /** Returns [start, end] of a length-delimited field and skips past it. */
  span(): [number, number] {
    const len = this.varint(), start = this.pos;
    this.pos += len;
    if (this.pos > this.end) throw new Error("truncated field");
    return [start, this.pos];
  }
  string(): string { const [s, e] = this.span(); return this.utf8.decode(this.buf.subarray(s, e)); }
  sub(): Reader { const [s, e] = this.span(); return new Reader(this.buf, s, e); }
  skip(wire: number) {
    if (wire === VARINT) this.varint();
    else if (wire === FIXED64) this.pos += 8;
    else if (wire === LEN) this.span();
    else if (wire === FIXED32) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
}

// --- service alerts ----------------------------------------------------------

/** GTFS-realtime Alert.Effect enum values we care about (unlisted ones pass through as-is). */
export const EFFECT = {
  NO_SERVICE: 1, REDUCED_SERVICE: 2, SIGNIFICANT_DELAYS: 3, DETOUR: 4,
  ADDITIONAL_SERVICE: 5, MODIFIED_SERVICE: 6, OTHER_EFFECT: 7, UNKNOWN_EFFECT: 8,
  STOP_MOVED: 9, NO_EFFECT: 10, ACCESSIBILITY_ISSUE: 11,
} as const;

/** One EntitySelector: what a piece of an alert applies to. */
export interface AlertEntity {
  routeId?: string;
  /** GTFS route_type (0 light/streetcar rail, 1 subway, 2 rail, 3 bus, ...). */
  routeType?: number;
  stopId?: string;
}

export interface Alert {
  id: string;
  cause?: number;
  effect?: number;
  informedEntity: AlertEntity[];
  header: string;
  description: string;
}

export interface AlertFeed {
  /** POSIX seconds when the feed was generated. */
  timestamp?: number;
  alerts: Alert[];
}

export function decodeAlertFeed(bytes: Uint8Array): AlertFeed {
  const r = new Reader(bytes);
  const feed: AlertFeed = { alerts: [] };
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) feed.timestamp = readHeaderTimestamp(r.sub());
    else if (f === 2 && w === LEN) {
      const a = readAlertEntity(r.sub());
      if (a) feed.alerts.push(a);
    } else r.skip(w);
  }
  return feed;
}

function readAlertEntity(r: Reader): Alert | undefined {
  let id = "";
  let alert: Omit<Alert, "id"> | undefined;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) id = r.string();
    else if (f === 5 && w === LEN) alert = readAlert(r.sub());
    else r.skip(w);
  }
  return alert && { id, ...alert };
}

function readAlert(r: Reader): Omit<Alert, "id"> {
  let cause: number | undefined, effect: number | undefined;
  let header = "", description = "";
  const informedEntity: AlertEntity[] = [];
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 5 && w === LEN) informedEntity.push(readEntitySelector(r.sub()));
    else if (f === 6 && w === VARINT) cause = r.varint();
    else if (f === 7 && w === VARINT) effect = r.varint();
    else if (f === 10 && w === LEN) header = readTranslatedString(r.sub());
    else if (f === 11 && w === LEN) description = readTranslatedString(r.sub());
    else r.skip(w);
  }
  return { cause, effect, informedEntity, header, description };
}

function readEntitySelector(r: Reader): AlertEntity {
  const e: AlertEntity = {};
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 2 && w === LEN) e.routeId = r.string();
    else if (f === 3 && w === VARINT) e.routeType = r.varint();
    else if (f === 5 && w === LEN) e.stopId = r.string();
    else r.skip(w);
  }
  return e;
}

/** The English translation, falling back to the feed's first (usually only) one. */
function readTranslatedString(r: Reader): string {
  let en = "", first = "";
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) {
      const t = r.sub();
      let text = "", lang = "";
      while (!t.done) {
        const [tf, tw] = t.tag();
        if (tf === 1 && tw === LEN) text = t.string();
        else if (tf === 2 && tw === LEN) lang = t.string();
        else t.skip(tw);
      }
      if (!first) first = text;
      if (!en && (lang === "en" || !lang)) en = text;
    } else r.skip(w);
  }
  return en || first;
}

export function decodeVehicleFeed(bytes: Uint8Array): VehicleFeed {
  const r = new Reader(bytes);
  const feed: VehicleFeed = { vehicles: [] };
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) feed.timestamp = readHeaderTimestamp(r.sub());
    else if (f === 2 && w === LEN) {
      const v = readEntity(r.sub());
      if (v) feed.vehicles.push(v);
    } else r.skip(w);
  }
  return feed;
}

function readHeaderTimestamp(r: Reader): number | undefined {
  let ts: number | undefined;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 3 && w === VARINT) ts = r.varint();
    else r.skip(w);
  }
  return ts;
}

function readEntity(r: Reader): VehiclePosition | undefined {
  let entityId = "";
  let v: Partial<VehiclePosition> | undefined;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) entityId = r.string();
    else if (f === 4 && w === LEN) v = readVehiclePosition(r.sub());
    else r.skip(w);
  }
  if (!v || v.lat === undefined || v.lon === undefined) return undefined;
  return {
    id: v.id || entityId,
    tripId: v.tripId ?? "",
    routeId: v.routeId ?? "",
    lat: v.lat,
    lon: v.lon,
    ...(v.bearing !== undefined && { bearing: v.bearing }),
    ...(v.speed !== undefined && { speed: v.speed }),
    ...(v.timestamp !== undefined && { timestamp: v.timestamp }),
  };
}

function readVehiclePosition(r: Reader): Partial<VehiclePosition> {
  const v: Partial<VehiclePosition> = {};
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === LEN) {           // TripDescriptor
      const t = r.sub();
      while (!t.done) {
        const [tf, tw] = t.tag();
        if (tf === 1 && tw === LEN) v.tripId = t.string();
        else if (tf === 5 && tw === LEN) v.routeId = t.string();
        else t.skip(tw);
      }
    } else if (f === 2 && w === LEN) {    // Position
      const p = r.sub();
      while (!p.done) {
        const [pf, pw] = p.tag();
        if (pf === 1 && pw === FIXED32) v.lat = p.float();
        else if (pf === 2 && pw === FIXED32) v.lon = p.float();
        else if (pf === 3 && pw === FIXED32) v.bearing = p.float();
        else if (pf === 5 && pw === FIXED32) v.speed = p.float();
        else p.skip(pw);
      }
    } else if (f === 5 && w === VARINT) v.timestamp = r.varint();
    else if (f === 8 && w === LEN) {      // VehicleDescriptor
      const d = r.sub();
      while (!d.done) {
        const [df, dw] = d.tag();
        if (df === 1 && dw === LEN) v.id = d.string();
        else d.skip(dw);
      }
    } else r.skip(w);
  }
  return v;
}
