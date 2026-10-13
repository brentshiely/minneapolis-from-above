/**
 * This app keeps nothing on a visitor's device between visits. Earlier
 * versions saved the layer choices (and a "welcome seen" flag) in
 * localStorage; this deletes any such leftovers the first time the page
 * loads, so a returning visitor's browser ends up holding nothing of ours.
 * (Within one tab, a few choices live in sessionStorage, which the browser
 * discards when the tab closes.)
 */
const LEGACY_KEYS = ["fromabove.layers", "mfa-splash-seen"];

export function forgetLegacyStorage(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch { /* storage blocked: nothing to forget */ }
}
