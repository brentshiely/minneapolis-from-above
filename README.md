# Minneapolis God Mode

An ambient, top-down living map of Minneapolis–Saint Paul. Real buses and light rail trains glide along their actual routes in near real time. It is something to glance at and feel the pulse of the city, not a dashboard: no required interaction beyond pan and zoom.

## Stack

- **Map:** [MapLibre GL JS](https://maplibre.org/) with free OpenStreetMap vector tiles from [OpenFreeMap](https://openfreemap.org/)
- **Moving layers:** [deck.gl](https://deck.gl/) rendered as an overlay on the map
- **Live data:** Metro Transit GTFS-realtime vehicle positions, decoded by a Cloudflare Pages Function at `/api/vehicles`
- **Route shapes:** Metro Transit static GTFS, baked into `public/data/` by `scripts/build-gtfs.mjs`
- **Hosting:** Cloudflare Pages (static frontend plus Functions)

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints. The dev server also serves `/api/vehicles` using the same code that runs on Cloudflare.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server with live data |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm test` | Unit tests (Node's built-in test runner) |
| `npm run e2e` | End-to-end checks against the running dev server in headless Chrome |
| `npm run perf` | Frame rate at metro, downtown and street zoom in headless Chrome (real GPU) |
| `npm run shot -- <dir> <warmup> name:lon,lat,zoom` | Screenshots of the running app |
| `npm run build:data` | Re-bake route data from Metro Transit's latest GTFS feed |
| `npm run preview` | Serve `dist/` plus Functions through Wrangler, as Cloudflare would |
| `npm run deploy` | Build and deploy to Cloudflare Pages (needs `wrangler login` once) |

`e2e`, `perf` and `shot` drive your installed Google Chrome (set `CHROME` to use another path) and expect `npm run dev` to be running.

## Backlog

Work is tracked story by story in the backlog artifact, with one commit per completed story. A copy of the backlog page lives in `backlog/`.
