# Adding a layer

Every layer follows the same path. This is the checklist, using the freight and Amtrak layers (`src/rail/`, `functions/api/amtrak.ts`) as the worked example. Commits are one story each, with tests, so `git log` shows complete examples (for instance the freight trains story, GM-89, and the Amtrak one after it).

## 1. Find the data and decide what is real

Say plainly, in code comments and in the hover card, what is measured and what is modeled. If the source has only a rate (trains a day, vehicles an hour), simulate positions at that rate and label them (see `src/rail/rail.ts`).

## 2. A baked file, if the data rarely changes

Put a script in `scripts/build-<thing>.mjs` that downloads the data, boils it down, and writes `public/data/<thing>.json`. Add an `npm run build:<thing>` entry. Load it in the app with `dataUrl("<thing>.json")` from `src/dataurl.ts`, which tags the address with a hash of the file so a re-bake is fetched at once. Example: `scripts/build-rail.mjs`.

## 3. An endpoint, if the data is live

A file in `functions/api/<name>.ts` is the endpoint `/api/<name>`. Export `onRequestGet`, return JSON with a `t` (POSIX seconds), a `cache-control` max-age, and a short cache on failure. Keep the parsing in an exported pure function so it can be tested. `npm run dev` serves it with the same code. Example: `functions/api/amtrak.ts`.

## 4. The model and the words

Under `src/<topic>/`: parse the response, simulate or animate it, and write `describe...()` functions that return `{ title, detail, meta }` for the hover card. Keep these free of the map so they test easily. Examples: `src/rail/rail.ts`, `src/rail/amtrak.ts`.

## 5. The drawing

A function in `src/layers/<name>.ts` that returns deck.gl layers. For something hoverable, add a second, wide, nearly invisible layer with `pickable: true` and an id starting `pick-` (see `src/layers/trains.ts`).

## 6. The wiring

- `src/toggles.ts`: add the key to `LayerKey` and an entry (label and a small SVG glyph) to `TOGGLE_GROUPS`.
- `src/main.ts`: start a poller with `startPoller("/api/<name>", intervalMs, onSnapshot)`, advance any simulation in the frame loop, add the layers behind `layersPanel.shown("<key>")`, list the feed in `layerFeeds` (so the panel flags it when failing) and in the visibility handler (so a hidden tab stops polling), and hand any hover data to `hover`.
- `src/hover.ts`: add a `Target` kind, set it from your `pick-` layer id in `pick()`, and describe it in `frame()`.

## 7. Tests and docs

Add `test/<topic>.test.ts` (`npm test`), covering the parsing, the simulation's rates, and the descriptions. Credit the source in the README. Run `npm run typecheck`.

## 8. Look at it

`npm run dev`, open the app, zoom to the layer, hover it. `npm run shots` retakes the README screenshots.
