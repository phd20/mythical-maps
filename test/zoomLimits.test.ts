import { describe, expect, it } from "vitest";
import { clampZoom, fitZoom, maxZoomFor, viewportFrom, zoomLimits } from "../src/ui/zoomLimits";

describe("fitZoom", () => {
  it("is native zoom when the container matches the image", () => {
    expect(fitZoom(4096, 3072, 4096, 3072)).toBe(4);
  });

  it("drops one level per halving of the container, limited by the tighter side", () => {
    expect(fitZoom(4096, 3072, 1024, 768)).toBe(2);
    // Width is the tighter side here: 1024 / 4096.
    expect(fitZoom(4096, 3072, 1024, 2000)).toBe(2);
    expect(fitZoom(8192, 6144, 1024, 768)).toBe(2);
  });

  it("floors to the zoom snap so the whole image fits", () => {
    // log2(800 / 4096) ≈ -2.356, log2(600 / 3072) ≈ -2.356 → 4 - 2.356 = 1.644 → 1.5
    expect(fitZoom(4096, 3072, 800, 600)).toBe(1.5);
    expect(fitZoom(4096, 3072, 800, 600, 1)).toBe(1);
    expect(fitZoom(4096, 3072, 800, 600, 0)).toBeCloseTo(4 + Math.log2(800 / 4096), 10);
  });

  it("can go below zoom 0 for small panes, and above native for big ones", () => {
    expect(fitZoom(256, 256, 128, 128)).toBe(-1);
    expect(fitZoom(256, 256, 1024, 1024)).toBe(2);
  });

  it("rejects an empty container", () => {
    expect(() => fitZoom(100, 100, 0, 10)).toThrow(RangeError);
  });
});

describe("zoomLimits", () => {
  it("runs from fit to z + 2", () => {
    expect(maxZoomFor(4096, 3072)).toBe(6);
    expect(zoomLimits(4096, 3072, 1024, 768)).toEqual({ min: 2, max: 6 });
  });

  it("caps the fit at the max for a tiny image in a large pane", () => {
    expect(zoomLimits(100, 100, 4000, 4000)).toEqual({ min: 2, max: 2 });
  });

  it("clampZoom keeps a zoom inside the limits", () => {
    const limits = { min: 1.5, max: 6 };
    expect(clampZoom(0, limits)).toBe(1.5);
    expect(clampZoom(3, limits)).toBe(3);
    expect(clampZoom(9, limits)).toBe(6);
  });
});

describe("viewportFrom", () => {
  it("rounds centre to 1e-4 and zoom to 1e-3, without -0", () => {
    expect(viewportFrom([-95.123456, 127.98765], 2.71828)).toEqual({ center: [-95.1235, 127.9877], zoom: 2.718 });
    const v = viewportFrom([-0.00001, 0], 0);
    expect(Object.is(v.center[0], -0)).toBe(false);
  });
});
