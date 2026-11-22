import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { crc32, FIXTURES, generateFixtureImages } from "../scripts/make-fixture-images.mjs";
import { validateMap } from "../src/core/schema";

const MAPS_DIR = fileURLToPath(new URL("../test-vault/Maps/", import.meta.url));
const ID_RE = /^[a-z][0-9a-z]{7}$/;

interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  idat: Buffer;
}

function readPng(file: string): PngInfo {
  const buf = readFileSync(file);
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat: Buffer[] = [];
  let info: Omit<PngInfo, "idat"> | undefined;
  let off = 8;
  let sawEnd = false;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    expect(buf.readUInt32BE(off + 8 + len)).toBe(crc32(type, data));
    const name = type.toString("ascii");
    if (name === "IHDR") {
      info = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), bitDepth: data[8]!, colourType: data[9]! };
    } else if (name === "IDAT") {
      idat.push(data);
    } else if (name === "IEND") {
      sawEnd = true;
    }
    off += 12 + len;
  }
  expect(sawEnd).toBe(true);
  if (!info) throw new Error("no IHDR");
  return { ...info, idat: Buffer.concat(idat) };
}

describe("fixture image generator", () => {
  const dir = mkdtempSync(join(tmpdir(), "mm-fixtures-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("defaults to the 4k and 8k fixture sizes", () => {
    expect(FIXTURES).toEqual([
      { name: "fixture-4k.png", width: 4096, height: 3072 },
      { name: "fixture-8k.png", width: 8192, height: 6144 },
    ]);
  });

  it("writes valid PNGs with the requested width and height", async () => {
    const files = await generateFixtureImages(dir, [
      { name: "a.png", width: 300, height: 200 },
      { name: "b.png", width: 64, height: 1100 },
    ]);
    expect(files).toEqual([join(dir, "a.png"), join(dir, "b.png")]);

    const a = readPng(files[0]!);
    expect([a.width, a.height, a.bitDepth, a.colourType]).toEqual([300, 200, 8, 2]);
    // Decompressed data is one filter byte plus RGB per pixel, per row.
    expect(inflateSync(a.idat).length).toBe(200 * (1 + 300 * 3));

    const b = readPng(files[1]!);
    expect([b.width, b.height]).toEqual([64, 1100]);
    expect(inflateSync(b.idat).length).toBe(1100 * (1 + 64 * 3));
  });
});

/** What each fixture is meant to exercise. */
const EXPECTED: Record<string, { type: string | undefined; version: number } | "invalid-json"> = {
  "all-types.map": { type: "mythical-map", version: 1 },
  "big-8k.map": { type: "mythical-map", version: 1 },
  "perf-8k-200pins.map": { type: "mythical-map", version: 1 },
  "broken-links.map": { type: "mythical-map", version: 1 },
  "missing-image.map": { type: "mythical-map", version: 1 },
  "future-version.map": { type: "mythical-map", version: 99 },
  "not-mythical.map": { type: undefined, version: 1 },
  "invalid-json.map": "invalid-json",
};

interface RawFeature {
  id: string;
  type: string;
  parentId?: string;
  rank: string;
  isHidden?: boolean;
  visibilityRange?: [number, number];
  pos?: [number, number];
  polygon?: [number, number][];
  polyline?: [number, number][];
  link?: string;
}

interface RawMap {
  type?: string;
  version: number;
  image: { path: string; width: number; height: number };
  features: RawFeature[];
}

function load(name: string): RawMap {
  return JSON.parse(readFileSync(join(MAPS_DIR, name), "utf8")) as RawMap;
}

/** Bounds per design D3: lat in [-h/2^z, 0], lng in [0, w/2^z]. */
function inImage(map: RawMap, [lat, lng]: [number, number]): boolean {
  const { width: w, height: h } = map.image;
  const z = Math.max(0, Math.ceil(Math.log2(Math.max(w, h) / 256)));
  const s = 2 ** z;
  return lat <= 0 && lat >= -h / s && lng >= 0 && lng <= w / s;
}

describe(".map fixtures", () => {
  it("has exactly the expected fixture files", () => {
    const files = readdirSync(MAPS_DIR).filter((f) => f.endsWith(".map")).sort();
    expect(files).toEqual(Object.keys(EXPECTED).sort());
  });

  it("invalid-json.map is not parseable JSON", () => {
    expect(() => load("invalid-json.map")).toThrow(SyntaxError);
  });

  for (const [name, want] of Object.entries(EXPECTED)) {
    if (want === "invalid-json") continue;
    it(`${name} has the intended type and version markers`, () => {
      const map = load(name);
      expect(map.type).toBe(want.type);
      expect(map.version).toBe(want.version);
    });
  }

  for (const name of ["all-types.map", "big-8k.map", "broken-links.map", "missing-image.map", "future-version.map"]) {
    it(`${name} has well-formed ids, parents, ranks and in-image positions`, () => {
      const map = load(name);
      const ids = new Set<string>();
      for (const f of map.features) {
        expect(f.id).toMatch(ID_RE);
        expect(ids.has(f.id)).toBe(false);
        ids.add(f.id);
        expect(f.rank).toMatch(/^[a-zA-Z][0-9a-zA-Z]*$/);
      }
      for (const f of map.features) {
        if (f.parentId) expect(map.features.find((p) => p.id === f.parentId)?.type).toBe("folder");
        const points = [f.pos, ...(f.polygon ?? []), ...(f.polyline ?? [])].filter((p) => p !== undefined);
        for (const p of points) expect(inImage(map, p), `${f.id} ${JSON.stringify(p)}`).toBe(true);
      }
    });
  }

  it("all-types.map covers every feature type and the visibility cases", () => {
    const map = load("all-types.map");
    expect(map.image).toEqual({ path: "Maps/fixture-4k.png", width: 4096, height: 3072 });
    const types = new Set(map.features.map((f) => f.type));
    expect([...types].sort()).toEqual(["folder", "label", "path", "pin", "region"]);

    const folders = map.features.filter((f) => f.type === "folder");
    const childOf = (id: string) => map.features.filter((f) => f.parentId === id);
    expect(folders.some((f) => !f.isHidden && childOf(f.id).some((c) => c.type === "pin"))).toBe(true);
    expect(folders.some((f) => f.isHidden === true && childOf(f.id).length > 0)).toBe(true);
    expect(map.features.some((f) => f.type === "pin" && !f.parentId && f.link)).toBe(true);
    expect(map.features.some((f) => JSON.stringify(f.visibilityRange) === "[0.5,1]")).toBe(true);
    expect(map.features.find((f) => f.type === "region")!.polygon!.length).toBeGreaterThanOrEqual(3);
    expect(map.features.find((f) => f.type === "path")!.polyline!.length).toBeGreaterThanOrEqual(2);
  });

  it("big-8k.map uses the 8k image", () => {
    expect(load("big-8k.map").image).toEqual({ path: "Maps/fixture-8k.png", width: 8192, height: 6144 });
  });

  it("broken-links.map links to notes that do not exist", () => {
    const notes = new Set(
      readdirSync(join(MAPS_DIR, "..", "Places")).map((f) => f.replace(/\.md$/, "")),
    );
    const links = load("broken-links.map").features.map((f) => f.link?.split("#")[0]).filter(Boolean);
    expect(links.filter((l) => !notes.has(l!)).length).toBeGreaterThanOrEqual(2);
  });

  it("missing-image.map points at an image that does not exist", () => {
    const { path } = load("missing-image.map").image;
    expect(readdirSync(MAPS_DIR)).not.toContain(path.replace(/^Maps\//, ""));
  });

  it("Westmarch.md lists maps that exist", () => {
    const note = readFileSync(join(MAPS_DIR, "..", "Places", "Westmarch.md"), "utf8");
    const line = note.split("\n").find((l) => l.startsWith("maps:"));
    expect(line).toBe('maps: ["[[all-types.map]]", "[[big-8k.map]]"]');
  });
});

// Cross-check: fixtures meant to be valid must pass the real schema (bead 2.2).

describe("fixtures against the v1 schema", () => {
  const dir = new URL("../test-vault/Maps/", import.meta.url);
  for (const name of ["all-types.map", "big-8k.map", "broken-links.map", "missing-image.map"]) {
    it(`${name} validates`, () => {
      const result = validateMap(JSON.parse(readFileSync(new URL(name, dir), "utf8")));
      expect(result.ok ? [] : result.issues).toEqual([]);
    });
  }
  for (const name of ["future-version.map", "not-mythical.map"]) {
    it(`${name} is rejected`, () => {
      expect(validateMap(JSON.parse(readFileSync(new URL(name, dir), "utf8"))).ok).toBe(false);
    });
  }
});
