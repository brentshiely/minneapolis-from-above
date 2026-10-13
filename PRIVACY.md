# Privacy

Minneapolis From Above is built to know nothing about you. This page says
what that means, and where it has limits.

## What the app does not do

- **No accounts, no cookies, no tracking.** There is no sign-in, no analytics,
  no advertising, no fingerprinting, and no third-party scripts, fonts or
  widgets. The page loads code only from its own address.
- **It never asks where you are.** The browser features that could (location,
  camera, microphone, motion sensors and the rest) are switched off for the
  page by a `Permissions-Policy` header.
- **Nothing is kept on your device between visits.** The layers you switch off
  and whether you have seen the welcome card are remembered only for the life
  of that browser tab (`sessionStorage`) so a reload doesn't undo them; the
  browser discards them when the tab closes. Earlier versions saved those in
  `localStorage`; the app deletes any such leftovers the first time it loads.
- **No database.** The server side is a handful of stateless functions that
  fetch public data and answer. They store nothing about visitors, and the
  code writes no logs of requests.
- **No referrer.** Your browser is told never to say which page you came from
  or are on when it fetches anything (`Referrer-Policy: no-referrer`).

## What does leave your browser

1. **To this app's own server** (Cloudflare Pages): the page, its data, and
   `/api/...` requests for live feeds. Cloudflare, as the host, necessarily
   sees the address of every request, and processes it under
   [its own privacy policy](https://www.cloudflare.com/privacypolicy/). Nothing
   in this app's code reads, keeps or forwards your address.
2. **Your searches.** What you type in the search box is sent to this app's
   server, which asks the Metropolitan Council's geocoder and the Photon
   (OpenStreetMap) geocoder for matches. Only the text is passed on, never your
   address or browser details. Answers are cached on Cloudflare's edge for up
   to a day, keyed by the search text alone, with nothing about who asked.
3. **Map pieces, straight from their publishers.** Your browser fetches the
   base map from `tiles.openfreemap.org`, and aerial photography and terrain
   shading from `imagery.nationalmap.gov` and `elevation.nationalmap.gov`
   (USGS). Those services see your IP address, your browser type, and the
   patch of map you are looking at, as any map does. They receive no referrer
   and no cookies from us. These three are the only places your browser talks
   to directly; routing every map tile through this app's server would be
   possible but would cost far more than the free hosting allows.

Everything else (buses, trains, planes, weather, river gauges, camera
snapshots, wildlife photos, crime incidents and so on) is fetched by the
server, so the people who publish it never see you. Camera snapshots and
wildlife photos pass through `/api/image`, which only ever fetches a camera id
or an iNaturalist photo id, never an address you supply.

## About the people on the map

- Buses, trains, planes and satellites are public, published feeds.
- Police incident layers come from cities' own open-data portals, which already
  publish locations only to the block or district; the app masks the one
  source that does not. They show no names or case details.
- Wildlife sightings carry the species and time, not who reported them.

## Questions

Open an issue at https://github.com/brentshiely/minneapolis-from-above.
