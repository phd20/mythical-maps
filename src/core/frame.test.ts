import { describe, expect, it } from "vitest";
import { boundsFor, pixelToPos, posToPixel, zoomFor } from "./frame";

describe("zoomFor", () => {
  it("is 5 for 8192x6144", () => {
    expect(zoomFor(8192, 6144)).toBe(5);
  });

  it("is 0 for images smaller than 256 px", () => {
    expect(zoomFor(100, 50)).toBe(0);
    expect(zoomFor(1, 1)).toBe(0);
    expect(zoomFor(255, 255)).toBe(0);
  });

  it("is 0 at exactly 256 px and steps up just above", () => {
    expect(zoomFor(256, 10)).toBe(0);
    expect(zoomFor(257, 10)).toBe(1);
    expect(zoomFor(10, 512)).toBe(1);
    expect(zoomFor(10, 513)).toBe(2);
  });

  it("uses the larger dimension", () => {
    expect(zoomFor(300, 4000)).toBe(zoomFor(4000, 300));
    expect(zoomFor(300, 4000)).toBe(4);
  });

  it("rejects non-positive or non-finite dimensions", () => {
    expect(() => zoomFor(0, 100)).toThrow(RangeError);
    expect(() => zoomFor(100, -1)).toThrow(RangeError);
    expect(() => zoomFor(Number.NaN, 100)).toThrow(RangeError);
    expect(() => zoomFor(Number.POSITIVE_INFINITY, 100)).toThrow(RangeError);
  });
});

describe("boundsFor", () => {
  it("covers 8192x6144 as [[-192, 0], [0, 256]]", () => {
    expect(boundsFor(8192, 6144)).toEqual([
      [-192, 0],
      [0, 256],
    ]);
  });

  it("uses raw pixels for images smaller than 256 px", () => {
    expect(boundsFor(200, 100)).toEqual([
      [-100, 0],
      [0, 200],
    ]);
  });
});

describe("pixelToPos / posToPixel", () => {
  it("maps the 8192x6144 bottom-right corner to [-192, 256]", () => {
    const z = zoomFor(8192, 6144);
    expect(z).toBe(5);
    expect(pixelToPos(8192, 6144, z)).toEqual([-192, 256]);
    expect(posToPixel([-192, 256], z)).toEqual([8192, 6144]);
  });

  it("maps the top-left corner to [0, 0]", () => {
    expect(pixelToPos(0, 0, 5)).toEqual([0, 0]);
    expect(posToPixel([0, 0], 5)).toEqual([0, 0]);
  });

  it("is the identity (with lat flipped) at z = 0", () => {
    const z = zoomFor(200, 100);
    expect(z).toBe(0);
    expect(pixelToPos(37, 81, z)).toEqual([-81, 37]);
  });

  it("round-trips pixels inside the image to within 1e-9", () => {
    const sizes: [number, number][] = [
      [8192, 6144],
      [200, 100],
      [1000, 3333],
      [12345, 678],
    ];
    for (const [w, h] of sizes) {
      const z = zoomFor(w, h);
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const x = (w * i) / 20 + (i % 3) * 0.123456789;
          const y = (h * j) / 20 + (j % 7) * 0.987654321;
          const [px, py] = posToPixel(pixelToPos(x, y, z), z);
          expect(Math.abs(px - x)).toBeLessThan(1e-9);
          expect(Math.abs(py - y)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("round-trips positions back through pixels to within 1e-9", () => {
    const z = zoomFor(8192, 6144);
    const positions: [number, number][] = [
      [-192, 256],
      [-0.1, 0.1],
      [-97.3333333, 12.5],
    ];
    for (const pos of positions) {
      const [x, y] = posToPixel(pos, z);
      const back = pixelToPos(x, y, z);
      expect(Math.abs(back[0] - pos[0])).toBeLessThan(1e-9);
      expect(Math.abs(back[1] - pos[1])).toBeLessThan(1e-9);
    }
  });
});
