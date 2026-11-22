import { describe, expect, it } from "vitest";
import { dropZoneFor, newFolderParent, planDrop, treeRows } from "./featureTree";
import { move } from "./features";
import type { Feature, MapDocument } from "./schema";

const pin = (id: string, rank: string, parentId?: string): Feature =>
  ({ id, type: "pin", rank, pos: [1, 1], ...(parentId ? { parentId } : {}) }) as Feature;
const folder = (id: string, rank: string, parentId?: string, isHidden?: boolean): Feature =>
  ({ id, type: "folder", rank, name: id, ...(parentId ? { parentId } : {}), ...(isHidden ? { isHidden } : {}) }) as Feature;

const map = (features: Feature[]): MapDocument =>
  ({ type: "mythical-map", version: 1, image: { path: "a.png", width: 10, height: 10 }, features }) as unknown as MapDocument;

const sample = map([
  pin("pinZ0000", "a2"),
  folder("towns000", "a0"),
  pin("inn00000", "a1", "towns000"),
  folder("inner000", "a0", "towns000", true),
  pin("deep0000", "a0", "inner000"),
]);

describe("treeRows", () => {
  it("orders by rank, depth first, with depth and hidden state", () => {
    const rows = treeRows(sample);
    expect(rows.map((r) => [r.feature.id, r.depth])).toEqual([
      ["towns000", 0],
      ["inner000", 1],
      ["deep0000", 2],
      ["inn00000", 1],
      ["pinZ0000", 0],
    ]);
    expect(rows.find((r) => r.feature.id === "deep0000")?.effectivelyHidden).toBe(true);
    expect(rows.find((r) => r.feature.id === "inn00000")?.effectivelyHidden).toBe(false);
  });

  it("omits children of collapsed folders", () => {
    const rows = treeRows(sample, new Set(["towns000"]));
    expect(rows.map((r) => r.feature.id)).toEqual(["towns000", "pinZ0000"]);
    expect(rows[0]?.collapsed).toBe(true);
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it("shows features with a missing parent at the root", () => {
    const rows = treeRows(map([pin("lost0000", "a0", "nothere0")]));
    expect(rows.map((r) => r.feature.id)).toEqual(["lost0000"]);
  });
});

describe("dropZoneFor", () => {
  it("splits folders in three and other features in two", () => {
    expect(dropZoneFor(0.1, true)).toBe("before");
    expect(dropZoneFor(0.5, true)).toBe("inside");
    expect(dropZoneFor(0.9, true)).toBe("after");
    expect(dropZoneFor(0.4, false)).toBe("before");
    expect(dropZoneFor(0.6, false)).toBe("after");
  });
});

describe("planDrop", () => {
  it("moves a pin into a folder as its last child", () => {
    const plan = planDrop(sample, "pinZ0000", "towns000", "inside");
    expect(plan).toEqual({ ok: true, id: "pinZ0000", placement: { parentId: "towns000" } });
    if (!plan.ok) return;
    const moved = move(sample, plan.id, plan.placement);
    expect(moved.ok && moved.map.features.find((f) => f.id === "pinZ0000")?.parentId).toBe("towns000");
  });

  it("reorders next to a sibling under the target's parent", () => {
    expect(planDrop(sample, "pinZ0000", "inn00000", "before")).toEqual({
      ok: true,
      id: "pinZ0000",
      placement: { parentId: "towns000", before: "inn00000" },
    });
    expect(planDrop(sample, "inn00000", "pinZ0000", "after")).toEqual({
      ok: true,
      id: "inn00000",
      placement: { parentId: null, after: "pinZ0000" },
    });
  });

  it("refuses dropping a folder into itself or a descendant", () => {
    for (const zone of ["inside", "before", "after"] as const) {
      expect(planDrop(sample, "towns000", "inner000", zone).ok).toBe(false);
      expect(planDrop(sample, "towns000", "deep0000", zone).ok).toBe(false);
      expect(planDrop(sample, "towns000", "towns000", zone).ok).toBe(false);
    }
  });

  it("refuses dropping inside a non-folder and unknown ids", () => {
    expect(planDrop(sample, "pinZ0000", "inn00000", "inside").ok).toBe(false);
    expect(planDrop(sample, "nope", "inn00000", "before").ok).toBe(false);
    expect(planDrop(sample, "pinZ0000", "nope", "before").ok).toBe(false);
  });
});

describe("newFolderParent", () => {
  it("is the selected folder, else the root", () => {
    expect(newFolderParent(sample, "towns000")).toBe("towns000");
    expect(newFolderParent(sample, "inn00000")).toBeNull();
    expect(newFolderParent(sample, null)).toBeNull();
    expect(newFolderParent(sample, "gone")).toBeNull();
  });
});
