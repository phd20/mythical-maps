/**
 * Which map images are decoded once and kept in a canvas (design D4 of
 * `cached-map-image`, spec map-view "Large images stay ready to zoom" and
 * "Other images render as before"). Pure: the caller supplies the file's
 * extension and bytes and the image size.
 */

/** Only images with more pixels than this are cached; smaller ones decode quickly. */
export const CACHE_MIN_PIXELS = 8_000_000;
/** Longest side a cached image may have (a common GPU texture limit). */
export const CACHE_MAX_SIDE = 16_384;
/** Most pixels a cached image may have: about 400 MB at 4 bytes per pixel. */
export const CACHE_MAX_PIXELS = 100_000_000;

/** Still raster formats. SVG is vector and GIF may animate, so both keep the image element. */
const CACHEABLE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "avif"]);

/** True when a `width` × `height` image is large enough to cache and within the limits. */
export function isCacheableSize(width: number, height: number): boolean {
  const pixels = width * height;
  return pixels > CACHE_MIN_PIXELS && pixels <= CACHE_MAX_PIXELS && width <= CACHE_MAX_SIDE && height <= CACHE_MAX_SIDE;
}

/** True when the extension and size allow caching. Checked before the file is read. */
export function mayCacheImage(extension: string, width: number, height: number): boolean {
  return CACHEABLE_EXTENSIONS.has(extension.toLowerCase()) && isCacheableSize(width, height);
}

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(at, at + length));

/** An animated PNG has an `acTL` chunk before the first `IDAT`. */
function isAnimatedPng(bytes: Uint8Array): boolean {
  if (ascii(bytes, 1, 3) !== "PNG") return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 8-byte signature, then chunks of length, type, data and a 4-byte CRC.
  for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
    const type = ascii(bytes, at + 4, 4);
    if (type === "acTL") return true;
    if (type === "IDAT") return false;
  }
  return false;
}

/** An animated WebP starts with a `VP8X` chunk whose animation flag is set. */
function isAnimatedWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 21 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  return ascii(bytes, 12, 4) === "VP8X" && (bytes[20]! & 0x02) !== 0;
}

/**
 * True for an animated PNG or WebP, which a canvas would freeze on one frame.
 * The content decides, not the extension. Animated AVIF is not detected.
 * Truncated or unknown data is reported as not animated.
 */
export function isAnimatedImage(bytes: Uint8Array): boolean {
  return isAnimatedPng(bytes) || isAnimatedWebp(bytes);
}
