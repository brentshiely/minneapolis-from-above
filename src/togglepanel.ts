import { loadToggles, saveToggles, TOGGLE_GROUPS, type LayerKey, type Toggles } from "./toggles.ts";

/**
 * A small collapsed button on the map's left edge that expands into a
 * checklist of the map's data layers, each with its own icon. Collapsed
 * by default so it never competes with the map itself.
 */
export class TogglePanel {
  toggles: Toggles;
  private root: HTMLElement;
  private button: HTMLButtonElement;
  private list: HTMLElement;
  private open = false;

  constructor(parent: HTMLElement) {
    this.toggles = loadToggles();
    this.root = document.createElement("div");
    this.root.id = "layers-panel";

    this.button = document.createElement("button");
    this.button.id = "layers-button";
    this.button.type = "button";
    this.button.setAttribute("aria-label", "Choose which data layers to show");
    this.button.innerHTML = layersGlyph();
    this.button.addEventListener("click", () => this.toggleOpen());

    this.list = document.createElement("div");
    this.list.id = "layers-list";
    this.list.hidden = true;
    for (const g of TOGGLE_GROUPS) {
      const row = document.createElement("label");
      row.className = "layers-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = this.toggles[g.key];
      box.addEventListener("change", () => {
        this.toggles[g.key] = box.checked;
        saveToggles(this.toggles);
        row.classList.toggle("off", !box.checked);
      });
      if (!box.checked) row.classList.add("off");
      const icon = document.createElement("span");
      icon.className = "layers-icon";
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">${g.glyph}</svg>`;
      const text = document.createElement("span");
      text.textContent = g.label;
      row.replaceChildren(box, icon, text);
      this.list.appendChild(row);
    }

    this.root.replaceChildren(this.button, this.list);
    parent.appendChild(this.root);
    document.addEventListener("click", (e) => {
      if (this.open && !this.root.contains(e.target as Node)) this.toggleOpen(false);
    });
  }

  private toggleOpen(next = !this.open) {
    this.open = next;
    this.list.hidden = !this.open;
    this.button.classList.toggle("open", this.open);
  }

  /** Whether a given layer should currently draw. */
  shown(key: LayerKey): boolean { return this.toggles[key]; }
}

function layersGlyph(): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">`
    + `<path d="M12 2 2 8l10 6 10-6z"/><path d="M2 13l10 6 10-6-2.2-1.3L12 16.7 4.2 11.7z"/></svg>`;
}
