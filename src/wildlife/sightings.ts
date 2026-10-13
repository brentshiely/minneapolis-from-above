/**
 * Recent, identification-verified wildlife sightings around the metro,
 * fading out over a few days as they age.
 */
import { ago, type Description } from "../describe.ts";
import type { Sighting, WildlifeResponse } from "../../functions/api/wildlife.ts";

export type { Sighting, WildlifeResponse };

/** Days after which a sighting is fully faded and no longer shown. */
export const FADE_DAYS = 4;

/** 1 (just seen) fading to 0 (fully aged out); never negative. */
export function sightingStrength(s: Sighting, nowS: number): number {
  const ageDays = (nowS - s.observedAt) / 86_400;
  return Math.max(0, Math.min(1, 1 - ageDays / FADE_DAYS));
}

const INAT_PHOTO = /^https:\/\/(?:inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/(\d{1,12}\/(?:medium|small|large|square)\.(?:jpe?g|png))$/i;

/**
 * An iNaturalist photo, addressed through our own server (functions/api/image.ts)
 * so Amazon's servers never see the visitor. Any other address gets no picture.
 */
export function photoUrl(url: string | undefined): string | undefined {
  const id = url ? INAT_PHOTO.exec(url)?.[1] : undefined;
  return id ? `/api/image?photo=${id}` : undefined;
}

export function describeSighting(s: Sighting, nowS: number): Description {
  return {
    title: `${s.species}.`,
    detail: `Seen ${ago(nowS - s.observedAt)}.`,
    meta: "iNaturalist",
    image: photoUrl(s.photo?.url),
  };
}

const PREVIEW: Sighting = {
  id: -1, species: "Red Fox", observedAt: 0, position: [-93.24, 44.95],
  photo: { url: "https://inaturalist-open-data.s3.amazonaws.com/photos/741695852/medium.jpg", attribution: "iNaturalist" },
};

/** `?wildlife=recent` previews a sighting from a few hours ago, without waiting on the real feed. */
export function previewWildlife(spec: string): WildlifeResponse | undefined {
  if (spec.trim().toLowerCase() !== "recent") return undefined;
  const t = Math.floor(Date.now() / 1000);
  return { t, sightings: [{ ...PREVIEW, observedAt: t - 3 * 3600 }] };
}
