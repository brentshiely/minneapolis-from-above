/**
 * Icons as white SVG silhouettes pointing north; layers tint them (mask)
 * and rotate them to each heading.
 */
const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`,
)}`;

/** Top-down airliner: swept wings, tailplane. */
export const PLANE_ICON = {
  url: svg(`<path fill="#fff" d="M32 3c1.9 0 3.2 2.6 3.2 5.6v15.2l23.3 12.3v5.3l-23.3-6.7v14.6l7.3 5.6v4.2L32 56.2l-10.5 2.9v-4.2l7.3-5.6V34.7L5.5 41.4v-5.3l23.3-12.3V8.6c0-3 1.3-5.6 3.2-5.6z"/>`),
  width: 64, height: 64, anchorY: 32, mask: true,
  id: "plane",
};

/** Top-down bus: body with a windshield cut out at the front (north). */
export const BUS_ICON = {
  url: svg(`<path fill="#fff" fill-rule="evenodd" d="M25 4h14a5 5 0 0 1 5 5v46a5 5 0 0 1-5 5H25a5 5 0 0 1-5-5V9a5 5 0 0 1 5-5zm1 5v8h12V9z"/>`),
  width: 64, height: 64, mask: true, id: "bus",
};

/** Top-down light rail train: two cars joined, cab window at the front. */
export const TRAIN_ICON = {
  url: svg(`<path fill="#fff" fill-rule="evenodd" d="M27 1h10a5 5 0 0 1 5 5v24H22V6a5 5 0 0 1 5-5zm1 4v6h8V5zM22 34h20v24a5 5 0 0 1-5 5H27a5 5 0 0 1-5-5zM30 30h4v4h-4z"/>`),
  width: 64, height: 64, mask: true, id: "train",
};

/** The ISS seen from above: a long truss with four pairs of solar wings. */
export const ISS_ICON = {
  url: svg(`<g fill="#fff"><rect x="6" y="30" width="52" height="4" rx="1"/><rect x="28" y="22" width="8" height="20" rx="2"/>`
    + `<rect x="7" y="12" width="7" height="16" rx="1"/><rect x="16" y="12" width="7" height="16" rx="1"/>`
    + `<rect x="41" y="12" width="7" height="16" rx="1"/><rect x="50" y="12" width="7" height="16" rx="1"/>`
    + `<rect x="7" y="36" width="7" height="16" rx="1"/><rect x="16" y="36" width="7" height="16" rx="1"/>`
    + `<rect x="41" y="36" width="7" height="16" rx="1"/><rect x="50" y="36" width="7" height="16" rx="1"/></g>`),
  width: 64, height: 64, mask: true, id: "iss",
};

/** A crewed station (Tiangong): a T of modules with two wings. */
export const STATION_ICON = {
  url: svg(`<g fill="#fff"><rect x="28" y="10" width="8" height="44" rx="3"/><rect x="14" y="26" width="36" height="8" rx="3"/>`
    + `<rect x="2" y="22" width="10" height="16" rx="1"/><rect x="52" y="22" width="10" height="16" rx="1"/></g>`),
  width: 64, height: 64, mask: true, id: "station",
};

/** A generic satellite: a body with two solar panels. */
export const SATELLITE_ICON = {
  url: svg(`<g fill="#fff"><rect x="25" y="25" width="14" height="14" rx="2"/><rect x="4" y="27" width="18" height="10" rx="1"/>`
    + `<rect x="42" y="27" width="18" height="10" rx="1"/><rect x="31" y="15" width="2" height="10"/><circle cx="32" cy="13" r="3"/></g>`),
  width: 64, height: 64, mask: true, id: "satellite",
};

/** A towboat running light: square bow with push knees, wheelhouse cut out. */
export const TOWBOAT_ICON = {
  url: svg(`<path fill="#fff" fill-rule="evenodd" d="M22 12h6v6h8v-6h6v40a6 6 0 0 1-6 6h-8a6 6 0 0 1-6-6zm7 14v9h6v-9z"/>`),
  width: 64, height: 64, mask: true, id: "towboat",
};

/** A towboat pushing barges ahead of it (north). */
export const TOW_ICON = {
  url: svg(`<path fill="#fff" fill-rule="evenodd" d="M21 2h22v19H21zM21 23h22v19H21zM25 44h14v14a4 4 0 0 1-4 4h-6a4 4 0 0 1-4-4zm4 4v6h6v-6z"/>`),
  width: 64, height: 64, mask: true, id: "tow",
};

/** A lock from above: two chamber walls with a gate across each end. */
export const LOCK_ICON = {
  url: svg(`<g fill="#fff"><rect x="18" y="4" width="7" height="56" rx="2"/><rect x="39" y="4" width="7" height="56" rx="2"/>`
    + `<rect x="25" y="12" width="14" height="4"/><rect x="25" y="48" width="14" height="4"/></g>`),
  width: 64, height: 64, mask: true, id: "lock",
};

/** A Starlink: a flat panel with one long solar array. */
export const STARLINK_ICON = {
  url: svg(`<g fill="#fff"><rect x="22" y="26" width="12" height="12" rx="1.5"/><rect x="36" y="29" width="24" height="6" rx="1"/></g>`),
  width: 64, height: 64, mask: true, id: "starlink",
};

/** A small cascade glyph: three wavy lines falling, for Minnehaha Falls. */
export const FALLS_ICON = {
  url: svg(`<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round">`
    + `<path d="M16 10 Q22 18 16 26 Q10 34 16 42 Q22 50 16 54"/>`
    + `<path d="M32 8 Q38 18 32 28 Q26 38 32 48 Q38 54 32 56"/>`
    + `<path d="M48 10 Q42 18 48 26 Q54 34 48 42 Q42 50 48 54"/></g>`),
  width: 64, height: 64, mask: true, id: "falls",
};

/** A traffic camera: a small round lens on a pole-mounted box, kept tiny
 * and plain so it reads as a fixture, not another moving dot. */
export const CAMERA_ICON = {
  url: svg(`<g fill="#fff"><rect x="16" y="22" width="26" height="20" rx="4"/><circle cx="46" cy="32" r="8"/><circle cx="46" cy="32" r="3.5"/><rect x="27" y="42" width="4" height="10" rx="1.5"/></g>`),
  width: 64, height: 64, mask: true, id: "camera",
};
