import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildPerfMap, PERF_FIXTURE } from "../scripts/make-perf-fixture.mjs";
import { validateMap } from "../src/core/schema";

const file = new URL(`../test-vault/Maps/${PERF_FIXTURE.name}`, import.meta.url);

interface RawFeature {
  id: string;
  type: string;
  parentId?: string;
  rank: string;
  pos?: [number, number];
  style?: { iconShape?: string };
}

describe("perf fixture (bead 8.1)", () => {
  const raw = JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof buildPerfMap> & {
    features: RawFeature[];
  };

  it("committed file matches the generator output (deterministic)", () => {
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(buildPerfMap(), null, 2) + "\n");
  });

  it("validates against the v1 schema", () => {
    const result = validateMap(raw);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it("uses the 8192x6144 image with 200 pins in folders and at top level", () => {
    const map = raw as unknown as { image: unknown; features: RawFeature[] };
    expect(map.image).toEqual({ path: "Maps/fixture-8k.png", width: 8192, height: 6144 });
    const pins = map.features.filter((f) => f.type === "pin");
    expect(pins).toHaveLength(200);
    expect(map.features.filter((f) => f.type === "folder")).toHaveLength(8);
    expect(pins.some((p) => p.parentId)).toBe(true);
    expect(pins.some((p) => !p.parentId)).toBe(true);
    expect(new Set(map.features.map((f) => f.id)).size).toBe(map.features.length);
    expect(new Set(pins.map((p) => p.style?.iconShape)).size).toBeGreaterThan(4);
  });

  it("spreads pins over every quadrant, inside the image bounds (z = 5)", () => {
    const pins = (raw as unknown as { features: RawFeature[] }).features.filter((f) => f.type === "pin");
    const quadrants = new Set<string>();
    for (const p of pins) {
      const [lat, lng] = p.pos!;
      expect(lat).toBeLessThanOrEqual(0);
      expect(lat).toBeGreaterThanOrEqual(-192);
      expect(lng).toBeGreaterThanOrEqual(0);
      expect(lng).toBeLessThanOrEqual(256);
      quadrants.add(`${lat < -96}${lng > 128}`);
    }
    expect(quadrants.size).toBe(4);
  });
});
