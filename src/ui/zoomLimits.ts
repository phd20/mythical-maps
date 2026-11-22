/**
 * Zoom limits and the opening viewport (design D3, spec map-view "Opening
 * viewport and zoom limits"). Pure: no Leaflet or DOM, so it is unit tested
 * directly and `baseMap.ts` only feeds it container sizes.
 *
 * - `minZoom` is the zoom at which the whole image fits the container.
 * - `maxZoom` is native zoom `z + 2`.
 *
 * In `CRS.Simple` one map unit is `2^zoom` screen pixels, and the image spans
 * `w / 2^z` × `h / 2^z` units, so at zoom `z + log2(s)` it is drawn at scale `s`.
 */
import { zoomFor, type LatLng } from "../core/frame";
import type { Viewport } from "../core/schema";

/**
 * Every Leaflet zoom option lives here. `zoomSnap: 0` (bead 4.6): zoom is
 * continuous, so any fractional zoom can be reached and saved. The wheel is
 * handled by `smoothWheelZoom.ts`; `ZOOM_DELTA` is the step for the zoom
 * buttons and double-click, which keep Leaflet's animated zoom.
 */
export const ZOOM_SNAP = 0;
export const ZOOM_DELTA = 0.5;

/** How far above native zoom `z` the user may zoom in. */
export const MAX_ZOOM_ABOVE_NATIVE = 2;

export interface ZoomLimits {
  min: number;
  max: number;
}

/** Largest zoom at which a `w` × `h` image fits a `paneW` × `paneH` container, floored to `snap` (0 = no snapping). */
export function fitZoom(w: number, h: number, paneW: number, paneH: number, snap: number = ZOOM_SNAP): number {
  if (!(paneW > 0 && paneH > 0)) throw new RangeError(`Container size must be positive, got ${paneW}x${paneH}`);
  const raw = zoomFor(w, h) + Math.log2(Math.min(paneW / w, paneH / h));
  // The epsilon keeps an exact multiple of `snap` from flooring one step down through float error.
  return snap > 0 ? Math.floor(raw / snap + 1e-9) * snap : raw;
}

/** Native zoom `z + 2`: the upper zoom limit. */
export function maxZoomFor(w: number, h: number): number {
  return zoomFor(w, h) + MAX_ZOOM_ABOVE_NATIVE;
}

/** Zoom limits for an image in a container: from fit up to `z + 2` (fit is capped at the max for tiny images). */
export function zoomLimits(w: number, h: number, paneW: number, paneH: number, snap: number = ZOOM_SNAP): ZoomLimits {
  const max = maxZoomFor(w, h);
  return { min: Math.min(fitZoom(w, h, paneW, paneH, snap), max), max };
}

export function clampZoom(zoom: number, limits: ZoomLimits): number {
  return Math.min(limits.max, Math.max(limits.min, zoom));
}

const round = (n: number, digits: number): number => {
  const f = 10 ** digits;
  // `0 + …` avoids writing -0.
  return 0 + Math.round(n * f) / f;
};

/**
 * A viewport to save from the current centre and zoom, rounded so the file
 * stays readable: 1e-4 map units is well under a screen pixel even at `z + 2`.
 */
export function viewportFrom(center: LatLng, zoom: number): Viewport {
  return { center: [round(center[0], 4), round(center[1], 4)], zoom: round(zoom, 3) };
}
