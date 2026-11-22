import { describe, expect, it } from "vitest";
import { createFeatureOp, creationParent, DEFAULT_NAMES } from "./create";
import { MapStore } from "./document";
import { children } from "./features";
import { rankAfter, rankBefore } from "./ids";
import { validateMap, type MapDocument } from "./schema";

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
