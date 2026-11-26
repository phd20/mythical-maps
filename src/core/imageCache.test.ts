import { describe, expect, it } from "vitest";
import {
  CACHE_MAX_PIXELS,
  CACHE_MAX_SIDE,
  CACHE_MIN_PIXELS,
  isAnimatedImage,
  isCacheableSize,
  levelFor,
  LEVEL_MIN_SIDE,
  levelSizes,
  mayCacheImage,
} from "./imageCache";

const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
const u32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const chunk = (type: string, length: number): number[] => [...u32(length), ...text(type), ...new Array<number>(length + 4).fill(0)];
const png = (...chunks: number[][]): Uint8Array => new Uint8Array([0x89, ...text("PNG\r\n\x1a\n"), ...chunks.flat()]);
const webp = (first: string, flags: number): Uint8Array =>
  new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...text(first), 10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("isCacheableSize", () => {
  it("needs more than the minimum number of pixels", () => {
    expect(isCacheableSize(CACHE_MIN_PIXELS / 2000, 2000)).toBe(false);
    expect(isCacheableSize(CACHE_MIN_PIXELS / 2000 + 1, 2000)).toBe(true);
  });

  it("allows each side up to the side limit", () => {
    expect(isCacheableSize(CACHE_MAX_SIDE, 1000)).toBe(true);
    expect(isCacheableSize(1000, CACHE_MAX_SIDE)).toBe(true);
    expect(isCacheableSize(CACHE_MAX_SIDE + 1, 1000)).toBe(false);
    expect(isCacheableSize(1000, CACHE_MAX_SIDE + 1)).toBe(false);
  });

  it("allows up to the pixel limit", () => {
    expect(isCacheableSize(CACHE_MAX_PIXELS / 10_000, 10_000)).toBe(true);
    expect(isCacheableSize(CACHE_MAX_PIXELS / 10_000 + 1, 10_000)).toBe(false);
  });

  it("rejects an empty image", () => {
    expect(isCacheableSize(0, 0)).toBe(false);
  });
});

describe("mayCacheImage", () => {
  it("accepts large still raster formats in any case", () => {
    for (const ext of ["png", "jpg", "jpeg", "webp", "bmp", "avif", "WEBP"]) expect(mayCacheImage(ext, 6144, 8192)).toBe(true);
  });

  it("rejects SVG, GIF and unknown extensions", () => {
    for (const ext of ["svg", "gif", "tif", ""]) expect(mayCacheImage(ext, 6144, 8192)).toBe(false);
  });

  it("rejects a small image", () => {
    expect(mayCacheImage("png", 2048, 2048)).toBe(false);
  });
});

describe("isAnimatedImage", () => {
  it("finds an acTL chunk before the image data of a PNG", () => {
    expect(isAnimatedImage(png(chunk("IHDR", 13), chunk("acTL", 8), chunk("IDAT", 4)))).toBe(true);
  });

  it("treats a PNG without acTL before IDAT as still", () => {
    expect(isAnimatedImage(png(chunk("IHDR", 13), chunk("IDAT", 4), chunk("IEND", 0)))).toBe(false);
    expect(isAnimatedImage(png(chunk("IHDR", 13), chunk("IDAT", 4), chunk("acTL", 8)))).toBe(false);
  });

  it("reads the animation flag of an extended WebP", () => {
    expect(isAnimatedImage(webp("VP8X", 0x02))).toBe(true);
    expect(isAnimatedImage(webp("VP8X", 0x22))).toBe(true);
    expect(isAnimatedImage(webp("VP8X", 0x20))).toBe(false);
    expect(isAnimatedImage(webp("VP8 ", 0x02))).toBe(false);
  });

  it("works on a view into a larger buffer", () => {
    const bytes = png(chunk("IHDR", 13), chunk("acTL", 8));
    const padded = new Uint8Array(bytes.length + 7);
    padded.set(bytes, 7);
    expect(isAnimatedImage(padded.subarray(7))).toBe(true);
  });

  it("does not throw on truncated or unknown data", () => {
    const full = [png(chunk("IHDR", 13), chunk("acTL", 8)), webp("VP8X", 0x02)];
    for (const bytes of full) for (let n = 0; n < bytes.length; n++) expect(() => isAnimatedImage(bytes.subarray(0, n))).not.toThrow();
    expect(isAnimatedImage(new Uint8Array())).toBe(false);
    expect(isAnimatedImage(new Uint8Array(text("GIF89a and the rest")))).toBe(false);
    // A length that points far past the end.
    expect(isAnimatedImage(png([...u32(0xffffffff), ...text("IHDR")]))).toBe(false);
  });
});

describe("levelSizes", () => {
  it("halves until the longest side is small enough", () => {
    expect(levelSizes(6144, 8192)).toEqual([
      { width: 6144, height: 8192 },
      { width: 3072, height: 4096 },
      { width: 1536, height: 2048 },
      { width: 768, height: 1024 },
    ]);
  });

  it("rounds odd sizes up", () => {
    expect(levelSizes(4001, 3001).map((s) => [s.width, s.height])).toEqual([
      [4001, 3001],
      [2001, 1501],
      [1001, 751],
    ]);
  });

  it("keeps only the image when it is already small", () => {
    expect(levelSizes(LEVEL_MIN_SIDE, 10)).toEqual([{ width: LEVEL_MIN_SIDE, height: 10 }]);
  });
});

describe("levelFor", () => {
  it("picks the smallest copy with at least one pixel per device pixel", () => {
    // The measured cases in design D6.
    expect([0.25, 0.35, 0.49, 0.69, 0.98].map((s) => levelFor(s, 4))).toEqual([2, 1, 1, 0, 0]);
  });

  it("switches exactly at each halving", () => {
    expect(levelFor(0.5, 4)).toBe(1);
    expect(levelFor(0.501, 4)).toBe(0);
    expect(levelFor(0.125, 4)).toBe(3);
    expect(levelFor(0.126, 4)).toBe(2);
  });

  it("stays within the copies there are", () => {
    expect(levelFor(4, 4)).toBe(0);
    expect(levelFor(0.001, 4)).toBe(3);
    expect(levelFor(0.001, 1)).toBe(0);
  });

  it("shows the full image when the scale is unknown", () => {
    expect(levelFor(Number.NaN, 4)).toBe(0);
    expect(levelFor(0, 4)).toBe(0);
  });
});
