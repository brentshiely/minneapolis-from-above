import type { GeocodeResponse, Place } from "../functions/api/geocode.ts";

export type { Place };

/** Wait this long after the last keystroke before asking; the answers are cached at the edge, but not for free. */
export const DEBOUNCE_MS = 350;
export const MIN_CHARS = 3;
const MAX_CACHED = 40;

/** Collapsed whitespace and lower case, so "Lake  St" and "lake st" are one query (and one cache entry). */
export const normalizeQuery = (q: string) => q.replace(/\s+/g, " ").trim().toLowerCase();

/** Arrow-key movement through `count` results: -1 means none highlighted, and it wraps. */
export function step(current: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

const glyph = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>`;

/**
 * A small round button on the map's left edge (above the layers button)
 * that opens a search box for an address, intersection, street or place.
 * Answers come from /api/geocode; picking one hands the place to `onPick`.
 * Closed, it's as quiet as the layers button.
 */
export class SearchBox {
  private root = document.createElement("div");
  private button = document.createElement("button");
  private form = document.createElement("form");
  private input = document.createElement("input");
  private list = document.createElement("ul");
  private note = document.createElement("div");
  private open = false;
  private results: Place[] = [];
  private active = -1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: AbortController | undefined;
  private cache = new Map<string, Place[]>();
  /** The query whose results are showing, to tell a stale response from the current one. */
  private shown = "";

  private onPick: (place: Place) => void;

  constructor(parent: HTMLElement, onPick: (place: Place) => void) {
    this.onPick = onPick;
    this.root.id = "search-panel";

    this.button.id = "search-button";
    this.button.type = "button";
    this.button.setAttribute("aria-label", "Search for an address or place");
    this.button.setAttribute("aria-expanded", "false");
    this.button.innerHTML = glyph;
    this.button.addEventListener("click", () => this.toggle());

    this.form.id = "search-form";
    this.form.setAttribute("role", "search");
    this.form.hidden = true;
    this.form.addEventListener("submit", (e) => { e.preventDefault(); void this.submit(); });

    this.input.id = "search-input";
    this.input.type = "search";
    this.input.placeholder = "Address, street or place";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.maxLength = 120;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-label", "Search for an address or place");
    this.input.setAttribute("aria-controls", "search-results");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.addEventListener("input", () => this.onType());
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    this.list.id = "search-results";
    this.list.setAttribute("role", "listbox");
    this.list.hidden = true;
    this.note.id = "search-note";
    this.note.setAttribute("role", "status");
    this.note.hidden = true;

    this.form.replaceChildren(this.input, this.list, this.note);
    this.root.replaceChildren(this.button, this.form);
    parent.appendChild(this.root);

    document.addEventListener("click", (e) => { if (this.open && !this.root.contains(e.target as Node)) this.toggle(false); });
    // "/" opens the search from anywhere, unless typing somewhere already.
    document.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? "") && !t?.isContentEditable) {
        e.preventDefault();
        this.toggle(true);
      }
    });
  }

  toggle(next = !this.open) {
    this.open = next;
    this.form.hidden = !next;
    this.button.classList.toggle("open", next);
    this.button.setAttribute("aria-expanded", String(next));
    if (next) this.input.focus();
    else { this.input.blur(); this.clearTimer(); this.inFlight?.abort(); }
  }

  private clearTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } }

  private onType() {
    this.clearTimer();
    const q = normalizeQuery(this.input.value);
    if (q.length < MIN_CHARS) { this.inFlight?.abort(); this.show([], q, ""); return; }
    const cached = this.cache.get(q);
    if (cached) { this.show(cached, q); return; }
    this.timer = setTimeout(() => void this.lookup(q), DEBOUNCE_MS);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); this.toggle(false); this.button.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!this.results.length) return;
      e.preventDefault();
      this.highlight(step(this.active, this.results.length, e.key === "ArrowDown" ? 1 : -1));
    }
  }

  /** Enter: the highlighted result, else the best match, asking now if the debounce hasn't fired yet. */
  private async submit() {
    const q = normalizeQuery(this.input.value);
    if (q.length < 2) return;
    if (this.active >= 0 && this.results[this.active]) return this.pick(this.results[this.active]);
    this.clearTimer();
    if (this.shown !== q) await this.lookup(q);
    if (this.shown === q && this.results[0]) this.pick(this.results[0]);
  }

  private async lookup(q: string) {
    this.inFlight?.abort();
    const ctl = (this.inFlight = new AbortController());
    this.show([], q, "Searching…");
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
      if (!res.ok) throw new Error(String(res.status));
      const { results } = (await res.json()) as GeocodeResponse;
      if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(q, results);
      if (normalizeQuery(this.input.value) === q) this.show(results, q);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      this.show([], q, "Search isn't available right now.");
    }
  }

  /** Render `results` for query `q`; with none, `message` (or "no match") says why. */
  private show(results: Place[], q: string, message?: string) {
    this.results = results;
    this.shown = q;
    this.active = -1;
    this.list.replaceChildren(...results.map((p, i) => {
      const li = document.createElement("li");
      li.id = `search-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const name = document.createElement("span");
      name.className = "search-name";
      name.textContent = p.label;
      li.appendChild(name);
      if (p.detail) {
        const d = document.createElement("span");
        d.className = "search-detail";
        d.textContent = p.detail;
        li.appendChild(d);
      }
      // mousedown, not click: it fires before the input loses focus.
      li.addEventListener("mousedown", (e) => { e.preventDefault(); this.pick(p); });
      return li;
    }));
    this.list.hidden = results.length === 0;
    this.input.setAttribute("aria-expanded", String(results.length > 0));
    this.input.removeAttribute("aria-activedescendant");
    const text = results.length ? "" : (message ?? (q.length >= MIN_CHARS ? "No match in the metro area." : ""));
    this.note.textContent = text;
    this.note.hidden = !text;
  }

  private highlight(i: number) {
    this.active = i;
    [...this.list.children].forEach((li, n) => {
      li.classList.toggle("active", n === i);
      li.setAttribute("aria-selected", String(n === i));
    });
    if (i >= 0) {
      this.input.setAttribute("aria-activedescendant", `search-opt-${i}`);
      this.list.children[i]?.scrollIntoView({ block: "nearest" });
    }
  }

  private pick(p: Place) {
    this.toggle(false);
    this.onPick(p);
  }
}
