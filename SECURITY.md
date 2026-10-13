# Security

Report a vulnerability privately through GitHub's
[security advisories](https://github.com/brentshiely/minneapolis-from-above/security/advisories/new)
(also listed in `/.well-known/security.txt`).

## How the app is hardened

- **A strict Content Security Policy** (`public/_headers`): scripts only from
  the app's own origin, no inline scripts, no `eval`, no plugins, no framing,
  no form posts, and network access only to the three map hosts named in
  [PRIVACY.md](PRIVACY.md). Also `Strict-Transport-Security`, `nosniff`,
  `X-Frame-Options`, `Referrer-Policy: no-referrer`, cross-origin isolation of
  the page (`COOP`/`CORP`) and a deny-all `Permissions-Policy`.
- **The same protections on every `/api` answer**, which `_headers` cannot
  reach (`functions/api/_middleware.ts`).
- **No untrusted HTML.** Everything shown from a feed goes through
  `textContent`; the only `innerHTML` is the app's own fixed icon markup.
- **Every server input is validated against a strict pattern before use**
  (camera and photo ids, NWS gauge ids, NORAD numbers, flight callsigns, tile
  coordinates, search text length), and every upstream host is fixed in code.
  There is no endpoint that fetches a caller-supplied URL.
- **`/api/image`** accepts only an id, checks the picture's content type and
  size, and answers with a sandboxing CSP.
- **The edge cache keys only on each endpoint's real parameters**, so
  cache-busting cannot reach the upstream feeds.
- **Dependencies:** `npm audit` reports zero known vulnerabilities, with one
  exception below. The few transitive packages with advisories (inside
  deck.gl's unused 3D-model loaders) are pinned to patched versions by
  `overrides`, and are not in the shipped bundle anyway.

## One known advisory, mitigated

`maplibre-gl` 5.24 is affected by GHSA-jrc7-96c5-q579 (an HTML sanitizer
bypass in the map's attribution text, fixed in 6.x). The app cannot upgrade
yet: deck.gl 9.4 does not support MapLibre 6 (the build was tried and the map
fails to start). It does not apply here because the only attribution text
comes from OpenFreeMap's own style and the app's own layers, and the page's CSP
forbids the inline event handlers the exploit needs. Revisit when deck.gl
supports MapLibre 6.

## Checking it yourself

```sh
npm run build && npx wrangler pages dev dist --port 8788 &
node scripts/csp-check.mjs http://localhost:8788   # CSP violations, headers, third-party hosts
npm audit
```
