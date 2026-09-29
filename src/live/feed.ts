import type { VehicleRow, VehiclesResponse } from "../../functions/api/vehicles.ts";

export type { VehicleRow };

export const POLL_MS = 15_000;

export interface FeedStatus {
  /** Page-clock ms of the last successful fetch, or 0. */
  lastOk: number;
  /** Consecutive failed fetches. */
  failures: number;
  paused: boolean;
}

export interface Poller {
  status: FeedStatus;
  /** Stop polling (e.g. while the tab is hidden). */
  pause(): void;
  /** Resume polling with an immediate fetch. */
  resume(): void;
}

/**
 * Polls a JSON endpoint whose body carries a feed timestamp `t`, and hands
 * each snapshot with a newer `t` to `onSnapshot`.
 */
/**
 * With `backoff`, repeated failures stretch the wait (doubling from the
 * interval up to `maxMs`), so a feed that's down isn't asked every few
 * seconds by every open page.
 */
export function startPoller<T extends { t: number }>(
  url: string, intervalMs: number, onSnapshot: (body: T) => void,
  backoff?: { maxMs: number },
): Poller {
  let lastT = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  const status: FeedStatus = { lastOk: 0, failures: 0, paused: false };

  function schedule() {
    clearTimeout(timer);
    const wait = backoff && status.failures > 1
      ? Math.min(backoff.maxMs, intervalMs * 2 ** (status.failures - 1))
      // Up to 15% early, so visitors who opened together drift apart
      // instead of all hitting the server on the same beat.
      : intervalMs * (0.85 + Math.random() * 0.15);
    if (!status.paused) timer = setTimeout(tick, wait);
  }

  async function tick() {
    if (inFlight || status.paused) return;
    inFlight = true;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${url} ${res.status}`);
      const body = (await res.json()) as T;
      status.lastOk = performance.now();
      status.failures = 0;
      if (body.t > lastT) {
        lastT = body.t;
        onSnapshot(body);
      }
    } catch (err) {
      status.failures++;
      // One warning per outage, not one per retry.
      if (status.failures === 1) console.warn("Live feed:", err);
    } finally {
      inFlight = false;
      schedule();
    }
  }

  tick();
  return {
    status,
    pause() { status.paused = true; clearTimeout(timer); },
    resume() { if (!status.paused) return; status.paused = false; tick(); },
  };
}

/** Buses and trains: polls /api/vehicles every 15 s. */
export function startFeed(onSnapshot: (feedTime: number, rows: VehicleRow[]) => void): Poller {
  return startPoller<VehiclesResponse>("/api/vehicles", POLL_MS, (b) => onSnapshot(b.t, b.v));
}

/** Duluth Transit Authority buses: the same feed shape, polled the same way, merged into the same Fleet. */
export function startDtaFeed(onSnapshot: (feedTime: number, rows: VehicleRow[]) => void): Poller {
  return startPoller<VehiclesResponse>("/api/dta-vehicles", POLL_MS, (b) => onSnapshot(b.t, b.v));
}
