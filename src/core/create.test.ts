import { describe, expect, it } from "vitest";
import { createFeatureOp, createShapeOp, creationParent, DEFAULT_NAMES, DEFAULT_SHAPE_NAMES, geometryPatch } from "./create";
import { MapStore } from "./document";
import { children } from "./features";
import { rankAfter, rankBefore } from "./ids";
import { validateMap, type Feature, type MapDocument } from "./schema";

const r1 = rankBefore(null);
const r2 = rankAfter(r1);

function fixture(): MapDocument {
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/x.png", width: 100, height: 100 },
    features: [
      { id: "towns000", type: "folder", name: "Towns", rank: r1 },
      { id: "tavern00", type: "pin", pos: [-2, 2], parentId: "towns000", rank: r1 },
      { id: "lonely00", type: "pin", pos: [-3, 3], rank: r2 },
    ],
  };
}

describe("creationParent", () => {
  it("is the root when nothing is selected or the id is unknown", () => {
    expect(creationParent(fixture(), null)).toBeNull();
    expect(creationParent(fixture(), "nope0000")).toBeNull();
  });
  it("is the selected folder", () => {
    expect(creationParent(fixture(), "towns000")).toBe("towns000");
  });
  it("is the parent of a selected non-folder, or the root for a root feature", () => {
    expect(creationParent(fixture(), "tavern00")).toBe("towns000");
    expect(creationParent(fixture(), "lonely00")).toBeNull();
  });
});

describe("createFeatureOp", () => {
  it("builds a pin insert with a default name, no stored style and no id", () => {
    const op = createFeatureOp(fixture(), "pin", [-5, 6], null);
    expect(op.feature).toEqual({ type: "pin", name: DEFAULT_NAMES.pin, pos: [-5, 6] });
    expect(op.placement).toEqual({ parentId: null });
  });

  it("builds a label insert", () => {
    const op = createFeatureOp(fixture(), "label", [-1, 1], null);
    expect(op.feature).toMatchObject({ type: "label", name: "New label", pos: [-1, 1] });
  });

  it("applies as the last child of the selected folder with a new id", () => {
    const store = new MapStore(fixture());
    const result = store.apply(createFeatureOp(store.map, "pin", [-5, 6], "towns000"));
    expect(result.ok).toBe(true);
    const kids = children(store.map, "towns000");
    expect(kids).toHaveLength(2);
    expect(kids.at(-1)?.id).toBe(result.id);
    expect(result.id).not.toBe("tavern00");
    expect(validateMap(store.map).ok).toBe(true);
  });

  it("applies as the last root feature when nothing is selected", () => {
    const store = new MapStore(fixture());
    const result = store.apply(createFeatureOp(store.map, "label", [-5, 6], null));
    const roots = children(store.map, null);
    expect(roots.at(-1)?.id).toBe(result.id);
    expect(roots.at(-1)?.parentId).toBeUndefined();
  });

  it("is refused by a locked store", () => {
    const store = new MapStore(fixture());
    store.lock();
    expect(store.apply(createFeatureOp(store.map, "pin", [0, 0], null)).ok).toBe(false);
    expect(store.map.features).toHaveLength(3);
  });
});

const pt = (lat: number, lng: number) => ({ lat, lng });

describe("createShapeOp", () => {
  it("creates a region from three or more vertices, dropping a repeated closing point", () => {
    const op = createShapeOp(fixture(), "region", [pt(0, 0), pt(0, 5), pt(-5, 5), pt(0, 0)], null);
    expect(op?.feature).toMatchObject({ type: "region", name: DEFAULT_SHAPE_NAMES.region, polygon: [[0, 0], [0, 5], [-5, 5]] });
    expect(op?.placement).toEqual({ parentId: null });
  });
  it("creates a path in the selected folder, and the result validates", () => {
    const map = fixture();
    const op = createShapeOp(map, "path", [pt(0, 0), pt(-5, 5)], "towns000");
    expect(op).not.toBeNull();
    const store = new MapStore(map);
    expect(store.apply(op!).ok).toBe(true);
    expect(validateMap(store.map).ok).toBe(true);
    expect(children(store.map, "towns000").map((f) => f.type)).toContain("path");
  });
  it("creates nothing with too few vertices", () => {
    expect(createShapeOp(fixture(), "region", [pt(0, 0), pt(1, 1)], null)).toBeNull();
    expect(createShapeOp(fixture(), "region", [pt(0, 0), pt(1, 1), pt(0, 0)], null)).toBeNull();
    expect(createShapeOp(fixture(), "path", [pt(0, 0)], null)).toBeNull();
    expect(createShapeOp(fixture(), "path", [pt(2, 2), pt(2, 2)], null)).toBeNull();
    expect(createShapeOp(fixture(), "path", [], null)).toBeNull();
  });
});

describe("geometryPatch", () => {
  const ring = [pt(0, 0), pt(0, 5), pt(-5, 5)];
  const region: Feature = { id: "reg00000", type: "region", polygon: [[0, 0], [0, 1], [-1, 1]], rank: r1 };
  const path: Feature = { id: "path0000", type: "path", polyline: [[0, 0], [1, 1]], rank: r1 };
  it("patches a region's polygon from Leaflet's [ring] shape", () => {
    expect(geometryPatch(region, [ring])).toEqual({ polygon: [[0, 0], [0, 5], [-5, 5]] });
  });
  it("patches polygons for a multipolygon region", () => {
    const multi: Feature = { id: "reg00001", type: "region", polygons: [[[0, 0], [0, 1], [-1, 1]]], rank: r1 };
    expect(geometryPatch(multi, [[ring], [[pt(1, 1), pt(1, 2), pt(2, 2)]]])).toEqual({
      polygons: [[[0, 0], [0, 5], [-5, 5]], [[1, 1], [1, 2], [2, 2]]],
    });
  });
  it("patches a path's polyline", () => {
    expect(geometryPatch(path, [pt(0, 0), pt(1, 1), pt(2, 0)])).toEqual({ polyline: [[0, 0], [1, 1], [2, 0]] });
  });
  it("is null for invalid geometry and non-shape features", () => {
    expect(geometryPatch(region, [[pt(0, 0), pt(1, 1)]])).toBeNull();
    expect(geometryPatch(path, [pt(0, 0)])).toBeNull();
    expect(geometryPatch({ id: "pin00000", type: "pin", pos: [0, 0], rank: r1 }, [])).toBeNull();
  });
});
