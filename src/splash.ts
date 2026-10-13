const SEEN_KEY = "mfa-splash-seen";

/**
 * A first-visit welcome card: what the app is, how it was built, and how
 * long that took. Shown once (remembered in the browser) and reopenable
 * from the small "about" button under the layers button.
 */
export class Splash {
  private overlay: HTMLElement;
  private button: HTMLButtonElement;
  private lastFocus: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.button = document.createElement("button");
    this.button.id = "about-button";
    this.button.type = "button";
    this.button.setAttribute("aria-label", "About Minneapolis From Above");
    this.button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1.1 15h-2.2v-6h2.2zM12 9.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>`;
    this.button.addEventListener("click", () => this.show());

    this.overlay = document.createElement("div");
    this.overlay.id = "splash";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.setAttribute("aria-labelledby", "splash-title");
    this.overlay.innerHTML = `
      <div class="splash-card">
        <div class="splash-body">
        <h1 id="splash-title">Minneapolis From Above</h1>
        <p class="splash-lede">A quiet, living map of Minneapolis–Saint Paul. Real buses and light rail glide along their actual routes, alongside freeway traffic, planes, satellites, freight and Amtrak trains, river boats, weather, wildlife and recent police activity. Glance at it and feel the pulse of the city. Pan and zoom, and hover or tap almost anything to see what it is.</p>
        <h2>How it was built</h2>
        <p>Built from scratch with <strong>Claude Code</strong>, in conversation with Brent Shiely, using MapLibre GL, deck.gl and TypeScript. Live data comes from Metro Transit, MnDOT, the National Weather Service, USGS, FAA and open city data; where nobody publishes exact positions (freight trains, cars on the freeways), the map draws them at the real rate and says so on the hover card.</p>
        <h2>How long it took</h2>
        <dl class="splash-stats">
          <div><dt>Timeframe</dt><dd>Sep 26 – Oct 12, 2026<small>17 days</small></dd></div>
          <div><dt>Claude Code engineering time</dt><dd>≈ 14 hours<small>across 12 working sessions</small></dd></div>
          <div><dt>Result</dt><dd>86 commits<small>~21,600 lines, 20 data layers</small></dd></div>
        </dl>
        <p class="splash-fine">Engineering time is estimated from commit timestamps (gaps over an hour count as breaks), so it is a floor, not a stopwatch.</p>
        </div>
        <button type="button" class="splash-go">Explore the map</button>
      </div>`;
    this.overlay.querySelector(".splash-go")!.addEventListener("click", () => this.hide());
    this.overlay.addEventListener("click", (e) => { if (e.target === this.overlay) this.hide(); });
    document.addEventListener("keydown", (e) => {
      if (!this.overlay.hidden && e.key === "Escape") this.hide();
    });

    parent.appendChild(this.button);
    parent.appendChild(this.overlay);
    if (!seen()) this.show();
  }

  private show() {
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.overlay.hidden = false;
    this.overlay.querySelector<HTMLElement>(".splash-go")!.focus();
  }

  private hide() {
    this.overlay.hidden = true;
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode: fine */ }
    (this.lastFocus ?? this.button).focus?.();
  }
}

function seen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; }
}
