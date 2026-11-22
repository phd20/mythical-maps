/**
 * LegendKeeper-compatible coordinate frame (design D3).
 *
 * For an image of `w` x `h` pixels:
 * - native zoom `z = max(0, ceil(log2(max(w, h) / 256)))`
 * - image pixel `(x, y)` (from the top-left) maps to `pos = [-y / 2^z, x / 2^z]`
 * - the image covers bounds `[[-h / 2^z, 0], [0, w / 2^z]]`
 *
 * Positions are `[lat, lng]` in Leaflet's `CRS.Simple`.
 */

/** A position in the map frame: `[lat, lng]`. */
export type LatLng = [number, number];

/** An image pixel: `[x, y]`, measured from the top-left corner. */
export type Pixel = [number, number];

/** Map bounds as `[southWest, northEast]`. */
export type Bounds = [LatLng, LatLng];

const TILE_SIZE = 256;

function assertDimensions(w: number, h: number): void {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new RangeError(`Image dimensions must be positive finite numbers, got ${w}x${h}`);
  }
}

/** Native zoom level for an image of `w` x `h` pixels. */
export function zoomFor(w: number, h: number): number {
  assertDimensions(w, h);
  return Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / TILE_SIZE)));
}

/** Bounds covered by an image of `w` x `h` pixels. */
export function boundsFor(w: number, h: number): Bounds {
  const scale = 2 ** zoomFor(w, h);
  return [
    [-h / scale, 0],
    [0, w / scale],
  ];
}

/** Convert image pixel `(x, y)` to a map position at native zoom `z`. */
export function pixelToPos(x: number, y: number, z: number): LatLng {
  const scale = 2 ** z;
  // `0 - …` avoids producing -0 for y = 0.
  return [0 - y / scale, x / scale];
}

/** Convert a map position at native zoom `z` back to an image pixel `[x, y]`. */
export function posToPixel(pos: LatLng, z: number): Pixel {
  const scale = 2 ** z;
  const [lat, lng] = pos;
  return [lng * scale, 0 - lat * scale];
}
