/**
 * Minneapolis Park Board swimming beaches, open or closed for water
 * quality, in season. Quiet the rest of the year, when every beach is
 * done being tested until next summer.
 */
import type { Description } from "../describe.ts";
import type { Beach, BeachesResponse } from "../../functions/api/beaches.ts";

export type { Beach, BeachesResponse };

export function describeBeach(b: Beach): Description {
  const detail = b.status === "open" ? "Open for swimming." : `Closed${b.reason ? `: ${b.reason}` : ""}.`;
  return { title: `${b.name}, ${b.lake}.`, detail, meta: "Minneapolis Park Board" };
}

const PREVIEW: Record<string, Beach> = {
  open: { id: "preview-open", name: "Main Beach", lake: "Lake Nokomis", status: "open", position: [-93.2412, 44.9089] },
  closed: { id: "preview-closed", name: "32nd Street Beach", lake: "Bde Maka Ska", status: "closed", reason: "High E. coli", position: [-93.3178, 44.9414] },
};

/** `?beach=open` (or closed) previews a status without waiting for the real season. */
export function previewBeaches(spec: string): BeachesResponse | undefined {
  const b = PREVIEW[spec.trim().toLowerCase()];
  if (!b) return undefined;
  return { t: Math.floor(Date.now() / 1000), beaches: [b] };
}
