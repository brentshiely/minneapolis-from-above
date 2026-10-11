/**
 * The address of a baked data file under /data, tagged with a hash of its
 * contents (computed at build time, see vite.config.ts).
 *
 * These files are cached for an hour by the browser and then served stale
 * while they refresh (public/_headers), which is right for files that rarely
 * change, but means a re-baked file (new freeway lines, a new schedule) can
 * be missed by anyone who already holds the old one. With the hash in the
 * address, a changed file is a new address and is fetched at once, and an
 * unchanged one stays cached.
 */
declare const __DATA_VERSIONS__: Record<string, string> | undefined;

export function dataUrl(file: string): string {
  const version = typeof __DATA_VERSIONS__ !== "undefined" ? __DATA_VERSIONS__[file] : undefined;
  return `/data/${file}${version ? `?v=${version}` : ""}`;
}
