import { describe, expect, it } from "vitest";
import {
  CURRENT_VERSION,
  MAP_TYPE,
  checkFeatureRefs,
  featureSchema,
  mapDocumentSchema,
  validateMap,
  type MapDocument,
  type ValidationIssue,
} from "./schema";

/** The example document from design D2, extended with one feature of each type. */
function validDoc(): MapDocument {
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/westmarch.webp", width: 8192, height: 6144 },
    viewport: { center: [-12, 16], zoom: 2 },
    features: [
      { id: "k3x9q2mz", type: "folder", name: "Towns", rank: "a0", isHidden: false },
      {
        id: "p7d1w0ab",
        type: "pin",
        name: "Rusty Flagon",
        parentId: "k3x9q2mz",
        rank: "a0",
        pos: [-10.5, 14.25],
        link: "Rusty Flagon",
        style: { iconGlyph: "beer-mug", iconColor: "#A7A7A7", iconShape: "pin", iconSize: "medium" },
        visibilityRange: [0, 1],
      },
      {
        id: "l1abcdef",
        type: "label",
        name: "Westmarch",
        rank: "a1",
        pos: [-50, 60],
        labelVisibility: "always",
        style: { labelSize: "2xl", textColor: "#ffffff", textEffect: "outline", textEffectColor: "#000000" },
      },
      {
        id: "r2abcdef",
        type: "region",
        name: "Old Forest",
        rank: "a2",
        polygon: [
          [0, 0],
          [-10, 0],
          [-10, 10],
        ],
        style: { color: "#228b22", fillOpacity: 0.4, fillStyle: "striped", borderStyle: "dashed", labelSize: "md" },
      },
      {
        id: "r3abcdef",
        type: "region",
        rank: "a3",
        polygons: [
          [
            [0, 0],
            [-1, 0],
            [-1, 1],
          ],
          [
            [5, 5],
            [4, 5],
            [4, 6],
          ],
        ],
      },
      {
        id: "t4abcdef",
        type: "path",
        name: "King's Road",
        rank: "a4",
        polyline: [
          [0, 0],
          [-20, 30],
        ],
        style: { color: "#8b4513", strokeWidth: 3, strokeStyle: "dashed", strokeOpacity: 0.8, textEffect: "background" },
        visibilityRange: [0.25, 0.75],
      },
      // 24-char cuid2 id (LegendKeeper compatibility)
      { id: "c" + "a1b2c3d4e5f6g7h8i9j0k1l", type: "folder", rank: "a5" },
    ],
  };
}

function withFeatures(features: unknown[]): unknown {
  return { ...validDoc(), features };
}

function issuesOf(input: unknown): ValidationIssue[] {
  const result = validateMap(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.issues;
}

describe("constants", () => {
  it("exports the type marker and version", () => {
    expect(MAP_TYPE).toBe("mythical-map");
    expect(CURRENT_VERSION).toBe(1);
  });
});

describe("validateMap: valid file loads", () => {
  it("returns a typed model with every feature intact", () => {
    const doc = validDoc();
    const result = validateMap(structuredClone(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map).toEqual(doc);
    expect(result.map.features).toHaveLength(7);
  });

  it("accepts a document without viewport and with no features", () => {
    const { viewport: _v, ...rest } = validDoc();
    expect(validateMap({ ...rest, features: [] }).ok).toBe(true);
  });

  it("mapDocumentSchema accepts the valid document too", () => {
    expect(mapDocumentSchema.safeParse(validDoc()).success).toBe(true);
  });
});

describe("validateMap: document shape", () => {
  it("rejects a wrong type marker as not a Mythical map", () => {
    const issues = issuesOf({ ...validDoc(), type: "something-else" });
    expect(issues).toContainEqual({ path: "type", message: expect.stringContaining("not a Mythical map") });
  });

  it("rejects other versions", () => {
    expect(issuesOf({ ...validDoc(), version: 2 }).map((i) => i.path)).toEqual(["version"]);
  });

  it("rejects non-object input with a root path", () => {
    expect(issuesOf(null)).toEqual([{ path: "", message: expect.any(String) }]);
    expect(issuesOf([])[0]?.path).toBe("");
  });

  it("requires image with a positive integer size", () => {
    const { image: _i, ...rest } = validDoc();
    expect(issuesOf(rest)).toContainEqual({ path: "image", message: "image is required" });
    const bad = issuesOf({ ...validDoc(), image: { path: "a.png", width: 0, height: 1.5 } }).map((i) => i.path);
    expect(bad).toEqual(["image.width", "image.height"]);
    expect(issuesOf({ ...validDoc(), image: { path: "", width: 1, height: 1 } })[0]?.path).toBe("image.path");
  });

  it("validates the viewport", () => {
    expect(issuesOf({ ...validDoc(), viewport: { center: [1], zoom: 1 } })[0]?.path).toBe("viewport.center");
    expect(issuesOf({ ...validDoc(), viewport: { center: [1, 2] } })[0]?.path).toBe("viewport.zoom");
  });

  it("requires features", () => {
    const { features: _f, ...rest } = validDoc();
    expect(issuesOf(rest)).toContainEqual({ path: "features", message: "features is required" });
  });

  it("rejects unknown top-level keys", () => {
    expect(issuesOf({ ...validDoc(), extra: 1 })[0]?.path).toBe("");
  });
});

describe("validateMap: pin without position is rejected", () => {
  it("names the feature id and the pos field", () => {
    const doc = validDoc();
    const features = doc.features.map((f) => (f.id === "p7d1w0ab" ? { ...f, pos: undefined } : f));
    const issues = issuesOf(withFeatures(features));
    expect(issues).toEqual([{ path: "features.1.pos", message: expect.stringContaining('"p7d1w0ab"') }]);
    expect(issues[0]?.message).toContain("pos");
  });

  it("applies to labels too, and rejects malformed positions", () => {
    expect(issuesOf(withFeatures([{ id: "l1abcdef", type: "label", rank: "a0" }]))[0]).toEqual({
      path: "features.0.pos",
      message: 'Feature "l1abcdef": pos is required',
    });
    expect(issuesOf(withFeatures([{ id: "p7d1w0ab", type: "pin", rank: "a0", pos: [1] }]))[0]?.path).toBe(
      "features.0.pos",
    );
  });
});

describe("validateMap: geometry per type", () => {
  it("region needs polygon or polygons", () => {
    const issues = issuesOf(withFeatures([{ id: "r2abcdef", type: "region", rank: "a0" }]));
    expect(issues).toEqual([{ path: "features.0.polygon", message: 'Feature "r2abcdef": region requires polygon or polygons' }]);
  });

  it("polygons need at least 3 vertices", () => {
    const two = [
      [0, 0],
      [1, 1],
    ];
    expect(issuesOf(withFeatures([{ id: "r2abcdef", type: "region", rank: "a0", polygon: two }]))[0]?.path).toBe(
      "features.0.polygon",
    );
    expect(issuesOf(withFeatures([{ id: "r2abcdef", type: "region", rank: "a0", polygons: [two] }]))[0]?.path).toBe(
      "features.0.polygons.0",
    );
  });

  it("path needs a polyline of at least 2 vertices", () => {
    expect(issuesOf(withFeatures([{ id: "t4abcdef", type: "path", rank: "a0" }]))[0]).toEqual({
      path: "features.0.polyline",
      message: 'Feature "t4abcdef": polyline is required',
    });
    expect(issuesOf(withFeatures([{ id: "t4abcdef", type: "path", rank: "a0", polyline: [[0, 0]] }]))[0]?.path).toBe(
      "features.0.polyline",
    );
  });

  it("folders take no geometry", () => {
    expect(issuesOf(withFeatures([{ id: "k3x9q2mz", type: "folder", rank: "a0", pos: [0, 0] }]))[0]?.path).toBe(
      "features.0",
    );
  });
});

describe("validateMap: common fields", () => {
  const pin = { id: "p7d1w0ab", type: "pin", rank: "a0", pos: [0, 0] };

  it("rejects unknown feature types", () => {
    expect(issuesOf(withFeatures([{ ...pin, type: "blob" }]))[0]).toEqual({
      path: "features.0.type",
      message: expect.stringContaining("type must be one of pin, label, region, path, folder"),
    });
  });

  it("checks the id pattern and names features without an id by index", () => {
    for (const id of ["P7d1w0ab", "7abcdefg", "abc", "abcdefghi"]) {
      expect(issuesOf(withFeatures([{ ...pin, id }]))[0]?.path).toBe("features.0.id");
    }
    expect(issuesOf(withFeatures([{ type: "folder", rank: "a0" }]))[0]).toEqual({
      path: "features.0.id",
      message: "Feature #0: id is required",
    });
  });

  it("requires a non-empty rank", () => {
    const { rank: _r, ...noRank } = pin;
    expect(issuesOf(withFeatures([noRank]))[0]?.message).toBe('Feature "p7d1w0ab": rank is required');
    expect(issuesOf(withFeatures([{ ...pin, rank: "" }]))[0]?.path).toBe("features.0.rank");
  });

  it("checks visibilityRange is within 0..1 with min <= max", () => {
    expect(validateMap(withFeatures([{ ...pin, visibilityRange: [0.5, 0.5] }])).ok).toBe(true);
    expect(issuesOf(withFeatures([{ ...pin, visibilityRange: [0.8, 0.2] }]))[0]).toEqual({
      path: "features.0.visibilityRange",
      message: expect.stringContaining("min must be ≤ max"),
    });
    expect(issuesOf(withFeatures([{ ...pin, visibilityRange: [-0.1, 1] }]))[0]?.path).toBe(
      "features.0.visibilityRange.0",
    );
    expect(issuesOf(withFeatures([{ ...pin, visibilityRange: [0, 1.1] }]))[0]?.path).toBe("features.0.visibilityRange.1");
  });

  it("checks labelVisibility values", () => {
    expect(issuesOf(withFeatures([{ ...pin, labelVisibility: "sometimes" }]))[0]?.path).toBe("features.0.labelVisibility");
  });

  it("rejects unknown keys on features and styles", () => {
    expect(issuesOf(withFeatures([{ ...pin, colour: "#ffffff" }]))[0]?.path).toBe("features.0");
    expect(issuesOf(withFeatures([{ ...pin, style: { iconColr: "#ffffff" } }]))[0]?.path).toBe("features.0.style");
    // a region style key is not valid on a pin
    expect(issuesOf(withFeatures([{ ...pin, style: { fillOpacity: 0.5 } }]))[0]?.path).toBe("features.0.style");
  });
});

describe("validateMap: style values", () => {
  const pin = { id: "p7d1w0ab", type: "pin", rank: "a0", pos: [0, 0] };
  const region = { id: "r2abcdef", type: "region", rank: "a0", polygon: [[0, 0], [1, 0], [1, 1]] };
  const path = { id: "t4abcdef", type: "path", rank: "a0", polyline: [[0, 0], [1, 1]] };

  it.each([
    [pin, { iconColor: "#fff" }, "features.0.style.iconColor"],
    [pin, { iconShape: "hexagon" }, "features.0.style.iconShape"],
    [pin, { iconSize: "large" }, "features.0.style.iconSize"],
    [pin, { iconGlyph: "" }, "features.0.style.iconGlyph"],
    [region, { fillOpacity: 2 }, "features.0.style.fillOpacity"],
    [region, { fillStyle: "hatched" }, "features.0.style.fillStyle"],
    [region, { borderStyle: "double" }, "features.0.style.borderStyle"],
    [region, { labelSize: "4xl" }, "features.0.style.labelSize"],
    [path, { strokeWidth: 0 }, "features.0.style.strokeWidth"],
    [path, { strokeOpacity: -1 }, "features.0.style.strokeOpacity"],
    [path, { textEffect: "glow" }, "features.0.style.textEffect"],
    [path, { textEffectColor: "red" }, "features.0.style.textEffectColor"],
  ])("rejects invalid style %#", (feature, style, expectedPath) => {
    expect(issuesOf(withFeatures([{ ...feature, style }]))[0]?.path).toBe(expectedPath);
  });

  it("rejects an empty pin link", () => {
    expect(issuesOf(withFeatures([{ ...pin, link: "" }]))[0]?.path).toBe("features.0.link");
  });
});

describe("validateMap: parent must be a folder", () => {
  const folder = { id: "k3x9q2mz", type: "folder", rank: "a0" };

  it("rejects a parentId that does not exist", () => {
    const issues = issuesOf(withFeatures([folder, { id: "p7d1w0ab", type: "pin", rank: "a0", pos: [0, 0], parentId: "zzzzzzzz" }]));
    expect(issues).toEqual([{ path: "features.1.parentId", message: expect.stringContaining('Feature "p7d1w0ab"') }]);
    expect(issues[0]?.message).toContain("parentId");
  });

  it("rejects a parentId naming a non-folder", () => {
    const issues = issuesOf(
      withFeatures([
        { id: "p7d1w0ab", type: "pin", rank: "a0", pos: [0, 0] },
        { id: "l1abcdef", type: "label", rank: "a1", pos: [0, 0], parentId: "p7d1w0ab" },
      ]),
    );
    expect(issues).toEqual([
      { path: "features.1.parentId", message: 'Feature "l1abcdef": parentId "p7d1w0ab" must name a folder, not a pin' },
    ]);
  });

  it("accepts nested folders and rejects folder cycles", () => {
    const nested = [folder, { id: "k4x9q2mz", type: "folder", rank: "a0", parentId: "k3x9q2mz" }];
    expect(validateMap(withFeatures(nested)).ok).toBe(true);
    const self = issuesOf(withFeatures([{ ...folder, parentId: "k3x9q2mz" }]));
    expect(self).toEqual([{ path: "features.0.parentId", message: expect.stringContaining("cycle") }]);
    const loop = issuesOf(withFeatures([{ ...folder, parentId: "k4x9q2mz" }, { ...nested[1] }]));
    expect(loop.map((i) => i.path)).toEqual(["features.0.parentId", "features.1.parentId"]);
  });
});

describe("validateMap: duplicate ids are rejected", () => {
  it("names the duplicated id at the second occurrence", () => {
    const issues = issuesOf(
      withFeatures([
        { id: "k3x9q2mz", type: "folder", rank: "a0" },
        { id: "k3x9q2mz", type: "pin", rank: "a1", pos: [0, 0] },
      ]),
    );
    expect(issues).toEqual([{ path: "features.1.id", message: 'Duplicate feature id "k3x9q2mz"' }]);
  });

  it("is reported together with shape errors", () => {
    const issues = issuesOf(
      withFeatures([
        { id: "k3x9q2mz", type: "folder", rank: "a0" },
        { id: "k3x9q2mz", type: "pin", rank: "a1" },
      ]),
    );
    expect(issues.map((i) => i.path).sort()).toEqual(["features.1.id", "features.1.pos"]);
  });
});

describe("mapDocumentSchema", () => {
  it("includes the cross-feature checks", () => {
    const result = mapDocumentSchema.safeParse(
      withFeatures([
        { id: "k3x9q2mz", type: "folder", rank: "a0" },
        { id: "k3x9q2mz", type: "folder", rank: "a1" },
      ]),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["features", 1, "id"]);
  });
});

describe("featureSchema", () => {
  it("narrows by type", () => {
    const f = featureSchema.parse({ id: "p7d1w0ab", type: "pin", rank: "a0", pos: [1, 2], link: "Note#Heading" });
    expect(f.type === "pin" && f.link).toBe("Note#Heading");
  });
});

describe("checkFeatureRefs", () => {
  it("tolerates non-array and malformed input", () => {
    expect(checkFeatureRefs(undefined)).toEqual([]);
    expect(checkFeatureRefs([null, 1, { id: 3 }, { id: "a", parentId: 5 }])).toEqual([]);
  });
});
