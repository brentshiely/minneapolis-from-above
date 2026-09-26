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
