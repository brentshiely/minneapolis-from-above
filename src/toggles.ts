/**
 * Which of the map's data layers the viewer wants to see. Persisted per
 * browser (localStorage) so a choice sticks across visits; every layer
 * defaults on, so nobody has to discover the panel to see the full map.
 */
export type LayerKey =
  | "transit" | "planes" | "satellites" | "traffic" | "cameras" | "incidents"
  | "river" | "warnings" | "games" | "beaches" | "airport" | "wildlife" | "snow" | "crime" | "gunfire" | "drones" | "freight";

export interface ToggleGroup {
  key: LayerKey;
  label: string;
  /** A small inline-SVG glyph body (paths only; the panel supplies the <svg> wrapper). */
  glyph: string;
}

export const TOGGLE_GROUPS: ToggleGroup[] = [
  { key: "transit", label: "Buses & trains", glyph: '<rect x="7" y="4" width="10" height="15" rx="2"/><circle cx="9" cy="17" r="1.4"/><circle cx="15" cy="17" r="1.4"/>' },
  { key: "planes", label: "Planes", glyph: '<path d="M12 2c.7 0 1.1 1 1.1 2v5.3l7.4 4v1.7l-7.4-2v4.6l2.3 1.8v1.3L12 21.4l-3.4 1.3v-1.3l2.3-1.8v-4.6l-7.4 2v-1.7l7.4-4V4c0-1 .4-2 1.1-2z"/>' },
  { key: "satellites", label: "Satellites & debris", glyph: '<circle cx="12" cy="12" r="2"/><rect x="2" y="10.5" width="5" height="3" rx="1"/><rect x="17" y="10.5" width="5" height="3" rx="1"/>' },
  { key: "traffic", label: "Freeway traffic", glyph: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 20 12 4l8 16"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2" d="M12 8v8"/>' },
  { key: "cameras", label: "Freeway cameras", glyph: '<rect x="3" y="8" width="11" height="8" rx="2"/><circle cx="17.5" cy="12" r="3.2"/>' },
  { key: "incidents", label: "Crashes & road work", glyph: '<path d="M12 2 22 20H2z"/>' },
  { key: "river", label: "River, locks & falls", glyph: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 8c2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3 2 3 4 3M2 15c2 0 2 3 4 3s2-3 4-3 2 3 4 3 2-3 4-3 2 3 4 3"/>' },
  { key: "warnings", label: "Weather watches & warnings", glyph: '<path d="M12 2 22 20H2z"/><rect x="10.6" y="9" width="2.8" height="6" rx="1.2" fill="#0d141c"/><circle cx="12" cy="17" r="1.4" fill="#0d141c"/>' },
  { key: "games", label: "Game days", glyph: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>' },
  { key: "beaches", label: "Beach status", glyph: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 15c2 0 2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3 2-3 4-3"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 20c2 0 2-3 4-3s2 3 4 3 2-3 4-3 2 3 4 3 2-3 4-3"/>' },
  { key: "airport", label: "MSP status", glyph: '<path d="M12 2c.7 0 1.1 1 1.1 2v5.3l7.4 4v1.7l-7.4-2v4.6l2.3 1.8v1.3L12 21.4l-3.4 1.3v-1.3l2.3-1.8v-4.6l-7.4 2v-1.7l7.4-4V4c0-1 .4-2 1.1-2z"/>' },
  { key: "wildlife", label: "Wildlife sightings", glyph: '<path d="M12 6C9 6 7 9 7 12c0 3 2 6 5 6s5-3 5-6c0-3-2-6-5-6zm-6 2a2 2 0 100 4 2 2 0 000-4zm12 0a2 2 0 100 4 2 2 0 000-4zM8 3a2 2 0 100 4 2 2 0 000-4zm8 0a2 2 0 100 4 2 2 0 000-4z"/>' },
  { key: "snow", label: "Snow emergencies", glyph: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M12 2v20M4 6l16 12M20 6 4 18M6 4l1 3-3 1M18 4l-1 3 3 1M6 20l1-3-3-1M18 20l-1-3 3-1"/>' },
  { key: "gunfire", label: "Shots fired", glyph: '<circle cx="12" cy="12" r="2.6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 2.5v4.5M12 17v4.5M2.5 12H7M17 12h4.5"/>' },
  { key: "drones", label: "Police drone flights", glyph: '<circle cx="12" cy="12" r="2.4"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M9.9 9.9 7 7M14.1 9.9 17 7M9.9 14.1 7 17M14.1 14.1 17 17"/><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="5.6" cy="5.6" r="2.2"/><circle cx="18.4" cy="5.6" r="2.2"/><circle cx="5.6" cy="18.4" r="2.2"/><circle cx="18.4" cy="18.4" r="2.2"/></g>' },
  { key: "freight", label: "Freight trains", glyph: '<rect x="2" y="9" width="6" height="7" rx="1"/><rect x="9" y="9" width="6" height="7" rx="1"/><rect x="16" y="9" width="6" height="7" rx="1"/><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M2 19.5h20"/>' },
  { key: "crime", label: "Crime events", glyph: '<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M12 2.5 20 6v6c0 5-3.4 8.2-8 9.5-4.6-1.3-8-4.5-8-9.5V6z"/>' },
];

const STORAGE_KEY = "fromabove.layers";

export type Toggles = Record<LayerKey, boolean>;

function defaults(): Toggles {
  const t = {} as Toggles;
  for (const g of TOGGLE_GROUPS) t[g.key] = true;
  return t;
}

export function loadToggles(): Toggles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults();
    const saved = JSON.parse(raw) as Partial<Toggles>;
    return { ...defaults(), ...saved };
  } catch {
    return defaults();
  }
}

export function saveToggles(t: Toggles) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch { /* private browsing, etc. */ }
}
