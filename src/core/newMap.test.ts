import { describe, expect, it } from "vitest";
import { newMapDocument, newMapPath } from "./newMap";
import { validateMap } from "./schema";
import { parseMap } from "./parse";
import { stringifyMap } from "./serialize";

describe("newMapDocument", () => {
  it("builds a valid, empty map centred on the image (spec scenario: Create from image)", () => {
    const map = newMapDocument({ path: "Maps/westmarch.webp", width: 8192, height: 6144 });
    expect(map).toEqual({
      type: "mythical-map",
      version: 1,
      image: { path: "Maps/westmarch.webp", width: 8192, height: 6144 },
      // z = 5, bounds [[-192, 0], [0, 256]]
      viewport: { center: [-96, 128], zoom: 0 },
      features: [],
    });
    expect(validateMap(map).ok).toBe(true);
  });

  it("round-trips through canonical serialization", () => {
    const map = newMapDocument({ path: "a.png", width: 100, height: 50 });
    const text = stringifyMap(map);
    const parsed = parseMap(text);
    expect(parsed.ok && parsed.map).toEqual(map);
    expect(map.viewport?.center).toEqual([-25, 50]);
  });

  it("rejects non-positive or fractional sizes", () => {
    expect(() => newMapDocument({ path: "a.png", width: 0, height: 10 })).toThrow(RangeError);
    expect(() => newMapDocument({ path: "a.png", width: 10.5, height: 10 })).toThrow(RangeError);
    expect(() => newMapDocument({ path: "a.png", width: Number.NaN, height: 10 })).toThrow(RangeError);
  });
});

describe("newMapPath", () => {
  const taken = (...paths: string[]) => {
    const set = new Set(paths);
    return (p: string) => set.has(p);
  };

  it("puts <basename>.map next to the image", () => {
    expect(newMapPath("Maps/westmarch.webp", taken())).toBe("Maps/westmarch.map");
    expect(newMapPath("Deep/er/x.y.png", taken())).toBe("Deep/er/x.y.map");
  });

  it("handles images at the vault root", () => {
    expect(newMapPath("world.jpg", taken())).toBe("world.map");
  });

  it("adds a numeric suffix when the name is taken (spec scenario: Name taken)", () => {
    expect(newMapPath("Maps/westmarch.webp", taken("Maps/westmarch.map"))).toBe("Maps/westmarch 1.map");
    expect(newMapPath("Maps/westmarch.webp", taken("Maps/westmarch.map", "Maps/westmarch 1.map"))).toBe(
      "Maps/westmarch 2.map",
    );
  });

  it("only checks names in the image's folder", () => {
    expect(newMapPath("Maps/westmarch.webp", taken("westmarch.map", "Other/westmarch.map"))).toBe("Maps/westmarch.map");
  });
});
