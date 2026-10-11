# Minneapolis From Above

**Live:** https://minneapolis-from-above.pages.dev

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

Then open the URL Vite prints. The dev server also serves the `/api/*` endpoints using the same code that runs on Cloudflare.

The map follows the real sun over Minneapolis. To preview another time of day, add `?at=HH:MM` (Minneapolis time), for example `?at=13:00` for day, `?at=19:05` for the blue hour, or `?at=22:00` for night. Add `?weather=` with `snow`, `heavy-snow`, `rain`, `storm`, `fog`, `partly-cloudy`, `breezy`, `windy` or `calm` to preview weather.

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
| `npm run build:freeways` | Re-bake the freeway sensor layout from MnDOT |
| `npm run build:rail` | Re-bake the railroad lines and trains-a-day from MnDOT |
| `npm run build:sats` | Snapshot every active satellite's orbit from CelesTrak (also runs on every deploy) |
| `npm run build:debris` | Snapshot the tracked space debris clouds from CelesTrak (also runs on every deploy) |
| `npm run build:ucs` | Re-bake satellite operators and purposes from the UCS database |
| `npm run preview` | Serve `dist/` plus Functions through Wrangler, as Cloudflare would |
| `npm run deploy` | Refresh the satellite and debris snapshots, build, and deploy to Cloudflare Pages (needs `wrangler login` once) |

`e2e`, `perf` and `shot` drive your installed Google Chrome (set `CHROME` to use another path) and expect `npm run dev` to be running.

## License

The code in this repository is released under the [MIT License](LICENSE). The data it displays belongs to the sources below and is used under their own terms; the license does not cover it.

## Credits and data sources

Everything on the map comes from someone else's work. Thank you to:

**Base map and imagery**
- [OpenFreeMap](https://openfreemap.org/) vector tiles, built from [OpenStreetMap](https://www.openstreetmap.org/copyright) data (© OpenStreetMap contributors, ODbL)
- Aerial photography: [USGS National Agriculture Imagery Program](https://www.usgs.gov/centers/eros/science/usgs-eros-archive-aerial-photography-national-agriculture-imagery-program-naip), via The National Map
- Weather radar: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/) (NEXRAD mosaic)

**Transit and roads**
- [Metro Transit](https://www.metrotransit.org/) GTFS and GTFS-realtime feeds
- [Duluth Transit Authority](https://duluthtransit.com/) GTFS and GTFS-realtime feeds
- [MnDOT](https://www.dot.state.mn.us/) freeway sensors and incidents (IRIS) and freeway cameras (via [CARS](https://public.carsprogram.org/))

**Sky and space**
- [CelesTrak](https://celestrak.org/) satellite orbits and catalog
- [Union of Concerned Scientists Satellite Database](https://www.ucsusa.org/resources/satellite-database) for satellite operators and purposes
- Aircraft positions from the community networks [adsb.lol](https://adsb.lol/) and [adsb.fi](https://adsb.fi/), and [The OpenSky Network](https://opensky-network.org/); flight routes from [adsbdb](https://www.adsbdb.com/)
- [NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov/) geomagnetic forecast

**Weather and water**
- [National Weather Service](https://www.weather.gov/) observations, watches and warnings, and the [National Water Prediction Service](https://water.noaa.gov/) river gauges
- [Open-Meteo](https://open-meteo.com/) air quality
- [U.S. Army Corps of Engineers](https://ndc.ops.usace.army.mil/) lock logs for river traffic
- [Minnesota DNR](https://www.dnr.state.mn.us/) fall color report

**City and civic data**
- Recent crime: the open-data services of the cities of Minneapolis, Saint Paul, Duluth, Brooklyn Center, Maple Grove, Eagan, Bloomington, Brooklyn Park and Rosemount
- Gunfire calls (shots fired, ShotSpotter, shootings): the City of Minneapolis open-data service
- Police drone flights: the public drone-as-first-responder flight logs of the St. Paul, Brooklyn Park, Minnetonka, Duluth, St. Cloud and Rochester police departments (flight paths only, delayed and offset for privacy)
- Freight trains: [MnDOT](https://www.dot.state.mn.us/)'s Minnesota rail network (railroad lines and the trains a day each operator reported to the Federal Railroad Administration). The trains themselves are synthetic: real frequency, made-up positions
- Snow emergencies: the cities of Minneapolis and Saint Paul
- Beach status: Minneapolis Park Board
- Airport status: [FAA National Airspace System Status](https://nasstatus.faa.gov/)
- Live scores: MLB Stats API, NHL, and ESPN scoreboards
- Address and place search: the Metropolitan Council's metro geocoders, and [Photon](https://photon.komoot.io/) with OpenStreetMap data (© OpenStreetMap contributors)

**Wildlife**
- Observations and photos from [iNaturalist](https://www.inaturalist.org/); each photo is shown only when its own license allows reuse, and remains the work of its observer

**Libraries**
- [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause), [deck.gl](https://deck.gl/) (MIT), [satellite.js](https://github.com/shashwatak/satellite-js) (MIT), and [Vite](https://vite.dev/) (MIT)
- Hosted on [Cloudflare Pages](https://pages.cloudflare.com/)

This is an independent hobby project. It is not affiliated with or endorsed by any of the organizations above.

## Backlog

Work is tracked story by story in the backlog artifact, with one commit per completed story. A copy of the backlog page lives in `backlog/`.
