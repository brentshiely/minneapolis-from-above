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
