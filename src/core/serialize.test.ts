import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateMap, type Feature, type MapDocument } from "./schema";
import { FEATURE_KEY_ORDER, STYLE_KEY_ORDER, sortFeatures, stringifyMap } from "./serialize";

/** Deterministic PRNG (mulberry32) returning values in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "parse" for these tests: JSON.parse + validateMap (parse.ts is a separate bead). */
function parse(text: string): MapDocument {
  const result = validateMap(JSON.parse(text));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.map;
}

/** Keys of every object in the output, in written order, found by top-level key path. */
const keysOf = (v: unknown): string[] => Object.keys(v as object);

const baseMap = (features: Feature[] = []): MapDocument => ({
  type: "mythical-map",
  version: 1,
  image: { path: "Maps/a.png", width: 4096, height: 3072 },
  features,
});

// ---------------------------------------------------------------------------
// Random map generator

function generateMap(rand: () => number): MapDocument {
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)] as T;
  const maybe = <T>(f: () => T): T | undefined => (rand() < 0.5 ? f() : undefined);
  const num = (): number => {
    switch (int(4)) {
      case 0:
        return int(512) - 256;
      case 1:
        return (rand() - 0.5) * 1000;
      case 2:
        return Math.round((rand() - 0.5) * 4000) / 16;
      default:
        return (rand() - 0.5) * 1e-7;
    }
  };
  const pair = (): [number, number] => [num(), num()];
  const verts = (min: number) => Array.from({ length: min + int(4) }, pair);
  const color = () => "#" + int(0x1000000).toString(16).padStart(6, "0").toUpperCase();
  const alnum = "0123456789abcdefghijklmnopqrstuvwxyz";
  const ids = new Set<string>();
  const newId = (): string => {
    for (;;) {
      let id = pick("abcdefghijklmnopqrstuvwxyz".split(""));
      for (let i = 0; i < 7; i++) id += pick(alnum.split(""));
      if (!ids.has(id)) {
        ids.add(id);
        return id;
      }
    }
  };
  const rank = () => pick(["a0", "a1", "a2", "Zz", "a0V", "b00", "a1G"]);
  const text = () =>
    maybe(() => ({ labelSize: pick(["xs", "md", "3xl"] as const), textColor: color(), textEffect: pick(["outline", "background"] as const), textEffectColor: color() }));
  const unit = () => Math.round(rand() * 100) / 100;

  const folders: string[] = [];
  const features: Feature[] = [];
  const count = int(12);
  for (let i = 0; i < count; i++) {
    const common = {
      id: newId(),
      name: maybe(() => pick(["Towns", "Rusty \"Flagon\"", "Ünïcødé ✦", "", "line\nbreak"])),
      parentId: folders.length > 0 ? maybe(() => pick(folders)) : undefined,
      rank: rank(),
      isHidden: maybe(() => rand() < 0.5),
      visibilityRange: maybe((): [number, number] => {
        const a = unit();
        const b = unit();
        return [Math.min(a, b), Math.max(a, b)];
      }),
      labelVisibility: maybe(() => pick(["always", "hover", "never"] as const)),
    };
    const type = pick(["pin", "label", "region", "path", "folder"] as const);
    let feature: Feature;
    switch (type) {
      case "pin":
        feature = {
          ...common,
          type,
          pos: pair(),
          link: maybe(() => pick(["Westmarch", "Places/The Keep#Gate"])),
          style: maybe(() => ({ iconSize: "small" as const, iconColor: color(), iconGlyph: "castle", iconShape: pick(["pin", "flag"] as const) })),
        };
        break;
      case "label":
        feature = { ...common, type, pos: pair(), style: text() };
        break;
      case "region":
        feature = {
          ...common,
          type,
          ...(rand() < 0.5 ? { polygon: verts(3) } : { polygons: Array.from({ length: 1 + int(3) }, () => verts(3)) }),
          style: maybe(() => ({ ...text(), borderStyle: "dashed" as const, color: color(), fillOpacity: unit(), fillStyle: "striped" as const })),
        };
        break;
      case "path":
        feature = {
          ...common,
          type,
          polyline: verts(2),
          style: maybe(() => ({ strokeOpacity: unit(), ...text(), color: color(), strokeWidth: 1 + int(8), strokeStyle: "dotted" as const })),
        };
        break;
      case "folder":
        feature = { ...common, type, style: maybe(() => ({})) };
        folders.push(common.id);
        break;
    }
    features.push(feature);
  }
  // Shuffle so input order differs from canonical order.
  for (let i = features.length - 1; i > 0; i--) {
    const j = int(i + 1);
    [features[i], features[j]] = [features[j] as Feature, features[i] as Feature];
  }
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/fixture.png", width: 1 + int(9000), height: 1 + int(9000) },
    viewport: maybe(() => ({ zoom: num(), center: pair() })),
    features,
  };
}

/** Drop undefined values, as JSON does, for comparison with a JSON.parse result. */
const withoutUndefined = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------

describe("stringifyMap", () => {
  it("writes document, image and viewport keys in fixed order", () => {
    const map = {
      features: [],
      viewport: { zoom: 2, center: [-96, 128] },
      image: { height: 3072, width: 4096, path: "Maps/a.png" },
      version: 1,
      type: "mythical-map",
    } as unknown as MapDocument;
    const out = JSON.parse(stringifyMap(map)) as Record<string, unknown>;
    expect(keysOf(out)).toEqual(["type", "version", "image", "viewport", "features"]);
    expect(keysOf(out.image)).toEqual(["path", "width", "height"]);
    expect(keysOf(out.viewport)).toEqual(["center", "zoom"]);
  });

  it("writes feature keys in fixed order and omits undefined keys", () => {
    const shuffled = [...FEATURE_KEY_ORDER].reverse();
    const values: Record<string, unknown> = {
      id: "a0000001",
      type: "pin",
      name: "N",
      parentId: undefined,
      rank: "a0",
      isHidden: false,
      pos: [1, 2],
      link: "L",
      visibilityRange: [0, 1],
      labelVisibility: "hover",
      style: { iconSize: "small" },
    };
    const pin = Object.fromEntries(shuffled.filter((k) => k in values).map((k) => [k, values[k]])) as unknown as Feature;
    const out = JSON.parse(stringifyMap(baseMap([pin]))) as { features: Record<string, unknown>[] };
    expect(keysOf(out.features[0])).toEqual(["id", "type", "name", "rank", "isHidden", "pos", "link", "visibilityRange", "labelVisibility", "style"]);
  });

  it("writes region and path geometry keys in fixed order", () => {
    const region = { style: {}, polygons: [[[0, 0], [0, 1], [1, 1]]], polygon: [[0, 0], [0, 1], [1, 1]], rank: "a0", type: "region", id: "a0000001" } as unknown as Feature;
    const path = { polyline: [[0, 0], [1, 1]], rank: "a1", type: "path", id: "a0000002" } as unknown as Feature;
    const out = JSON.parse(stringifyMap(baseMap([region, path]))) as { features: Record<string, unknown>[] };
    expect(keysOf(out.features[0])).toEqual(["id", "type", "rank", "polygon", "polygons", "style"]);
    expect(keysOf(out.features[1])).toEqual(["id", "type", "rank", "polyline"]);
  });

  it("writes style keys in schema declaration order for each type", () => {
    expect(STYLE_KEY_ORDER.pin).toEqual(["iconGlyph", "iconColor", "iconShape", "iconSize"]);
    expect(STYLE_KEY_ORDER.region).toEqual(["color", "fillOpacity", "fillStyle", "borderStyle", "labelSize", "textColor", "textEffect", "textEffectColor"]);
    expect(STYLE_KEY_ORDER.path).toEqual(["color", "strokeWidth", "strokeStyle", "strokeOpacity", "labelSize", "textColor", "textEffect", "textEffectColor"]);
    expect(STYLE_KEY_ORDER.label).toEqual(["labelSize", "textColor", "textEffect", "textEffectColor"]);
    expect(STYLE_KEY_ORDER.folder).toEqual([]);

    const styles: Record<string, Record<string, unknown>> = {
      pin: { iconSize: "small", iconShape: "flag", iconColor: "#000000", iconGlyph: "x" },
      label: { textEffectColor: "#000000", textEffect: "outline", textColor: "#000000", labelSize: "lg" },
      region: { textEffectColor: "#000000", labelSize: "lg", borderStyle: "none", fillStyle: "solid", fillOpacity: 0.5, color: "#000000" },
      path: { textColor: "#000000", strokeOpacity: 1, strokeStyle: "solid", strokeWidth: 2, color: "#000000" },
    };
    const geometry: Record<string, Record<string, unknown>> = {
      pin: { pos: [0, 0] },
      label: { pos: [0, 0] },
      region: { polygon: [[0, 0], [0, 1], [1, 1]] },
      path: { polyline: [[0, 0], [1, 1]] },
    };
    const features = Object.keys(styles).map(
      (type, i) => ({ id: `a000000${i}`, type, rank: `a${i}`, ...geometry[type], style: styles[type] }) as unknown as Feature,
    );
    const out = JSON.parse(stringifyMap(baseMap(features))) as { features: { type: string; style: object }[] };
    for (const f of out.features) {
      const expected = STYLE_KEY_ORDER[f.type as keyof typeof STYLE_KEY_ORDER].filter((k) => k in (styles[f.type] ?? {}));
      expect(keysOf(f.style)).toEqual(expected);
    }
  });

  it("puts unknown keys last, alphabetically, without dropping them", () => {
    const map = { ...baseMap([{ id: "a0000001", type: "folder", rank: "a0", zeta: 1, alpha: { b: 2, a: 1 } } as unknown as Feature]), extra: true };
    const text = stringifyMap(map as unknown as MapDocument);
    const out = JSON.parse(text) as { features: Record<string, unknown>[] } & Record<string, unknown>;
    expect(keysOf(out)).toEqual(["type", "version", "image", "features", "extra"]);
    expect(keysOf(out.features[0])).toEqual(["id", "type", "rank", "alpha", "zeta"]);
    expect(keysOf(out.features[0]?.alpha)).toEqual(["a", "b"]);
    expect(out).toEqual(withoutUndefined(map));
  });

  it("sorts features by (parentId, rank, id), with no parentId first", () => {
    const f = (id: string, rank: string, parentId?: string) => ({ id, type: "folder", rank, parentId }) as Feature;
    const features = [
      f("fzzzzzz1", "a0", "fbbbbbb1"),
      f("faaaaaa2", "a1"),
      f("fbbbbbb1", "a0", "faaaaaa1"),
      f("faaaaaa1", "a0"),
      f("fbbbbbb0", "a0", "faaaaaa1"),
      f("faaaaaa3", "Zz"), // "Z" < "a" by code unit
      f("fccccccc", "a0V", "faaaaaa1"),
    ];
    const out = JSON.parse(stringifyMap(baseMap(features))) as { features: Feature[] };
    expect(out.features.map((x) => x.id)).toEqual(["faaaaaa3", "faaaaaa1", "faaaaaa2", "fbbbbbb0", "fbbbbbb1", "fccccccc", "fzzzzzz1"]);
    expect(sortFeatures(features).map((x) => x.id)).toEqual(out.features.map((x) => x.id));
    expect(features[0]?.id).toBe("fzzzzzz1"); // input not mutated
  });

  it("writes coordinate pairs on one line and vertex lists one vertex per line", () => {
    const map: MapDocument = {
      ...baseMap([
        { id: "a0000001", type: "pin", rank: "a0", pos: [-10.5, 14.25], visibilityRange: [0, 1] },
        { id: "a0000002", type: "region", rank: "a1", polygons: [[[0, 0], [0, 1], [1, 1]]] },
        { id: "a0000003", type: "path", rank: "a2", polyline: [[0.1, 1e-7], [-0, 3]] },
      ]),
      viewport: { center: [-12, 16], zoom: 2 },
    };
    const text = stringifyMap(map);
    expect(text).toContain('    "center": [-12, 16],\n');
    expect(text).toContain('      "pos": [-10.5, 14.25],\n');
    expect(text).toContain('      "visibilityRange": [0, 1]\n');
    expect(text).toContain('      "polygons": [\n        [\n          [0, 0],\n          [0, 1],\n          [1, 1]\n        ]\n      ]\n');
    expect(text).toContain('      "polyline": [\n        [0.1, 1e-7],\n        [0, 3]\n      ]\n');
  });

  it("uses 2-space indent and ends with exactly one trailing newline", () => {
    const text = stringifyMap(baseMap());
    expect(text).toBe(
      '{\n  "type": "mythical-map",\n  "version": 1,\n  "image": {\n    "path": "Maps/a.png",\n    "width": 4096,\n    "height": 3072\n  },\n  "features": []\n}\n',
    );
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("is idempotent and loses no keys for 200 generated maps", () => {
    const rand = seeded(0x6d61_7073);
    for (let i = 0; i < 200; i++) {
      const map = generateMap(rand);
      const once = stringifyMap(map);
      const parsed = parse(once);
      expect(stringifyMap(parsed)).toBe(once);
      // Valid JSON that reads back to an equal object (features reordered).
      const original = withoutUndefined(map) as MapDocument;
      expect(parsed).toEqual({ ...original, features: sortFeatures(original.features) });
      expect(once.endsWith("}\n")).toBe(true);
    }
  });

  it("is stable on test-vault/Maps/all-types.map", () => {
    const fixture = fileURLToPath(new URL("../../test-vault/Maps/all-types.map", import.meta.url));
    const raw = readFileSync(fixture, "utf8");
    const map = parse(raw);
    const once = stringifyMap(map);
    const twice = stringifyMap(parse(once));
    expect(twice).toBe(once);
    const original = JSON.parse(raw) as MapDocument;
    expect(JSON.parse(once)).toEqual({ ...original, features: sortFeatures(original.features) });
  });
});
