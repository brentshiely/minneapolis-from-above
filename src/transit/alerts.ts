/**
 * Live Metro Transit service alerts: which routes they touch, and the
 * quiet caption for a genuinely major one. With nothing affected, this
 * renders nothing — the map looks exactly like an ordinary day.
 */
import type { AlertRow, AlertsResponse } from "../../functions/api/alerts.ts";
import { startPoller, type Poller } from "../live/feed.ts";

export type { AlertRow, AlertsResponse };

export const POLL_MS = 60_000;

/** Polls /api/alerts every minute; alerts don't need vehicle-feed urgency. */
export function startAlertsFeed(onSnapshot: (body: AlertsResponse) => void): Poller {
  return startPoller<AlertsResponse>("/api/alerts", POLL_MS, onSnapshot, { maxMs: 10 * 60_000 });
}

export interface AlertInfo {
  effect: number;
  header: string;
  description: string;
}

/** One row per affected route; first alert to claim a route wins. */
export function affectedFromRows(rows: AlertRow[]): Map<string, AlertInfo> {
  const m = new Map<string, AlertInfo>();
  for (const [, routeId, effect, header, description] of rows) {
    if (!m.has(routeId)) m.set(routeId, { effect, header, description });
  }
  return m;
}

/** Plain words for an Alert.Effect code, for the tooltip's small print. */
const EFFECT_WORD: Record<number, string> = {
  1: "No service", 2: "Reduced service", 3: "Delays", 4: "Detour",
  6: "Modified service", 7: "Service change",
};
export const effectWord = (effect: number): string => EFFECT_WORD[effect] ?? "Service alert";

/**
 * `?alert=blueline-detour` (etc.) previews a live alert without waiting for
 * one, so the feature can be checked on an ordinary day. Presets describe
 * a rail replacement in Metro Transit's own header style.
 */
const PRESETS: Record<string, { routeId: string; effect: number; header: string; description: string }> = {
  "blueline-detour": {
    routeId: "901", effect: 4,
    header: "Buses will replace METRO Blue Line trains between Fort Snelling and downtown Minneapolis stations for track maintenance.",
    description: "Shuttle buses replace Blue Line trains between Fort Snelling and downtown Minneapolis stations while crews repair the track. Trains resume once work is complete.",
  },
  "greenline-detour": {
    routeId: "902", effect: 4,
    header: "Buses will replace METRO Green Line trains between Union Depot and Raymond Ave. stations starting with first trains on Friday until Monday at first trains.",
    description: "Buses replace Green Line trains between Union Depot and Raymond Ave. stations to allow for needed maintenance. Train service resumes Monday with first trains.",
  },
};

/**
 * Keeps the affected-routes map in step with the feed. With nothing affected it shows nothing and `affected` is empty,
 * so routes draw exactly as they do on an ordinary day.
 */
export class AlertsWatch {
  affected = new Map<string, AlertInfo>();
  /** Called after `update` changes `affected`, so callers can rebuild layers. */
  onChange?: () => void;
  private key = "";

  update(body: AlertsResponse) {
    const key = JSON.stringify(body.a);
    if (key === this.key) return;
    this.key = key;
    this.affected = affectedFromRows(body.a);
    this.onChange?.();
  }
}

export function previewAlert(spec: string): AlertsResponse | undefined {
  const preset = PRESETS[spec.trim().toLowerCase()];
  if (!preset) return undefined;
  const { routeId, effect, header, description } = preset;
  return { t: Math.floor(Date.now() / 1000), a: [[`preview-${spec}`, routeId, effect, header, description]] };
}
