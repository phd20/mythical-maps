import { describe, expect, it } from "vitest";
import {
  ancestors,
  children,
  deleteSubtree,
  descendants,
  effectiveHidden,
  getFeature,
  insert,
  isVisible,
  move,
  restore,
  update,
  visibleAtZoom,
} from "./features";
import { rankAfter, rankBefore } from "./ids";
import type { Feature, MapDocument } from "./schema";
import { validateMap } from "./schema";

const r1 = rankBefore(null); // "a0"
const r2 = rankAfter(r1);
const r3 = rankAfter(r2);

/**
 * Tree:
 *   towns (folder)       r1
 *     inner (folder)     r1
 *       deep (pin)       r1
 *     tavern (pin)       r2
 *   lonely (pin)         r2
 *   river (path)         r3
 */
function fixture(): MapDocument {
  const features: Feature[] = [
    { id: "towns000", type: "folder", name: "Towns", rank: r1 },
    { id: "inner000", type: "folder", name: "Inner", parentId: "towns000", rank: r1 },
    { id: "deep0000", type: "pin", pos: [-1, 1], parentId: "inner000", rank: r1 },
    { id: "tavern00", type: "pin", pos: [-2, 2], parentId: "towns000", rank: r2, style: { iconColor: "#ff0000", iconShape: "flag" } },
    { id: "lonely00", type: "pin", pos: [-3, 3], rank: r2, name: "Lonely" },
    { id: "river000", type: "path", polyline: [[-1, 1], [-2, 2]], rank: r3 },
  ];
  return { type: "mythical-map", version: 1, image: { path: "m.png", width: 512, height: 512 }, features };
}

const ids = (fs: Feature[]) => fs.map((f) => f.id);

function ok<T extends { ok: boolean }>(res: T): Extract<T, { ok: true }> {
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res)}`);
  return res as Extract<T, { ok: true }>;
}

describe("queries", () => {
  it("children are sorted by rank then id", () => {
    const map = fixture();
    expect(ids(children(map, null))).toEqual(["towns000", "lonely00", "river000"]);
    expect(ids(children(map, "towns000"))).toEqual(["inner000", "tavern00"]);
    const tie: MapDocument = {
      ...map,
      features: [
        { id: "bbbbbbbb", type: "pin", pos: [0, 0], rank: r1 },
        { id: "aaaaaaaa", type: "pin", pos: [0, 0], rank: r1 },
      ],
    };
    expect(ids(children(tie, null))).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it("descendants walk the subtree depth-first", () => {
    expect(ids(descendants(fixture(), "towns000"))).toEqual(["inner000", "deep0000", "tavern00"]);
    expect(descendants(fixture(), "lonely00")).toEqual([]);
  });

  it("ancestors are nearest first", () => {
    expect(ids(ancestors(fixture(), "deep0000"))).toEqual(["inner000", "towns000"]);
    expect(ancestors(fixture(), "lonely00")).toEqual([]);
    expect(ancestors(fixture(), "missing0")).toEqual([]);
  });

  it("getFeature finds by id", () => {
    expect(getFeature(fixture(), "river000")?.type).toBe("path");
    expect(getFeature(fixture(), "nope0000")).toBeUndefined();
  });
});

describe("visibility", () => {
  it("hidden folder hides descendants at any depth, and unhiding shows them again", () => {
    const map = fixture();
    expect(effectiveHidden(map, "deep0000")).toBe(false);
    const hidden = ok(update(map, "towns000", { isHidden: true })).map;
    for (const id of ["towns000", "inner000", "deep0000", "tavern00"]) {
      expect(effectiveHidden(hidden, id)).toBe(true);
      expect(isVisible(hidden, id, 0, 0, 4)).toBe(false);
    }
    expect(effectiveHidden(hidden, "lonely00")).toBe(false);
    const shown = ok(update(hidden, "towns000", { isHidden: undefined })).map;
    expect(effectiveHidden(shown, "deep0000")).toBe(false);
    expect("isHidden" in getFeature(shown, "towns000")!).toBe(false);
  });

  it("a feature's own isHidden hides it", () => {
    const map = ok(update(fixture(), "lonely00", { isHidden: true })).map;
    expect(effectiveHidden(map, "lonely00")).toBe(true);
    expect(effectiveHidden(map, "missing0")).toBe(false);
  });

  it("zoom-gated label [0.5, 1] is hidden at min zoom and shown past the midpoint", () => {
    const label = { visibilityRange: [0.5, 1] as [number, number] };
    const [minZoom, maxZoom] = [-2, 4]; // midpoint 1
    expect(visibleAtZoom(label, minZoom, minZoom, maxZoom)).toBe(false);
    expect(visibleAtZoom(label, 0.9, minZoom, maxZoom)).toBe(false);
    expect(visibleAtZoom(label, 1, minZoom, maxZoom)).toBe(true); // inclusive
    expect(visibleAtZoom(label, 1.5, minZoom, maxZoom)).toBe(true);
    expect(visibleAtZoom(label, maxZoom, minZoom, maxZoom)).toBe(true);
    expect(visibleAtZoom(label, maxZoom + 1, minZoom, maxZoom)).toBe(false);
  });

  it("no visibilityRange is always visible", () => {
    expect(visibleAtZoom({}, -100, 0, 4)).toBe(true);
  });

  it("isVisible combines hidden and zoom gating", () => {
    const map = ok(
      insert(fixture(), { id: "label000", type: "label", pos: [0, 0], name: "Kingdom", visibilityRange: [0.5, 1] }),
    ).map;
    expect(isVisible(map, "label000", 0, 0, 4)).toBe(false);
    expect(isVisible(map, "label000", 3, 0, 4)).toBe(true);
    expect(isVisible(map, "missing0", 3, 0, 4)).toBe(false);
  });
});

describe("insert", () => {
  it("defaults to last at root and assigns a rank", () => {
    const res = ok(insert(fixture(), { id: "newpin00", type: "pin", pos: [0, 0], rank: "zzz" }));
    expect(res.id).toBe("newpin00");
    expect(ids(children(res.map, null)).at(-1)).toBe("newpin00");
    const created = getFeature(res.map, "newpin00")!;
    expect(created.rank > r3).toBe(true);
    expect("parentId" in created).toBe(false);
    expect(validateMap(res.map).ok).toBe(true);
  });

  it("generates an id when missing or taken", () => {
    const a = ok(insert(fixture(), { type: "pin", pos: [0, 0] }));
    expect(a.id).toMatch(/^[a-z][0-9a-z]{7}$/);
    const b = ok(insert(fixture(), { id: "lonely00", type: "pin", pos: [0, 0] }));
    expect(b.id).not.toBe("lonely00");
    expect(new Set(ids(b.map.features)).size).toBe(b.map.features.length);
  });

  it("inserts between siblings and keeps the others' ranks unchanged", () => {
    const map = fixture();
    const res = ok(insert(map, { id: "between0", type: "pin", pos: [0, 0] }, { parentId: "towns000", after: "inner000" }));
    expect(ids(children(res.map, "towns000"))).toEqual(["inner000", "between0", "tavern00"]);
    for (const f of map.features) expect(getFeature(res.map, f.id)).toBe(f);
    const before = ok(insert(map, { id: "first000", type: "pin", pos: [0, 0] }, { before: "towns000" }));
    expect(ids(children(before.map, null))).toEqual(["first000", "towns000", "lonely00", "river000"]);
  });

  it("goes into a folder as its last child", () => {
    const res = ok(insert(fixture(), { id: "child000", type: "pin", pos: [0, 0] }, { parentId: "inner000" }));
    expect(ids(children(res.map, "inner000"))).toEqual(["deep0000", "child000"]);
    expect(getFeature(res.map, "child000")?.parentId).toBe("inner000");
  });

  it("refuses a missing or non-folder parent, and unknown siblings", () => {
    expect(insert(fixture(), { type: "pin", pos: [0, 0] }, { parentId: "nope0000" }).ok).toBe(false);
    expect(insert(fixture(), { type: "pin", pos: [0, 0] }, { parentId: "lonely00" }).ok).toBe(false);
    expect(insert(fixture(), { type: "pin", pos: [0, 0] }, { after: "tavern00" }).ok).toBe(false);
    expect(insert(fixture(), { type: "pin", pos: [0, 0] }, { after: "towns000", before: "lonely00" }).ok).toBe(false);
  });
});

describe("move", () => {
  it("move into folder: parentId updated, becomes last child, nothing else changes", () => {
    const map = fixture();
    const res = ok(move(map, "lonely00", { parentId: "towns000" }));
    expect(getFeature(res.map, "lonely00")?.parentId).toBe("towns000");
    expect(ids(children(res.map, "towns000"))).toEqual(["inner000", "tavern00", "lonely00"]);
    for (const f of map.features) if (f.id !== "lonely00") expect(getFeature(res.map, f.id)).toBe(f);
    expect(validateMap(res.map).ok).toBe(true);
  });

  it("moves to root (removing parentId) and reorders among siblings", () => {
    const res = ok(move(fixture(), "tavern00", { parentId: null, before: "river000" }));
    expect("parentId" in getFeature(res.map, "tavern00")!).toBe(false);
    expect(ids(children(res.map, null))).toEqual(["towns000", "lonely00", "tavern00", "river000"]);
    const reordered = ok(move(fixture(), "tavern00", { parentId: "towns000", before: "inner000" }));
    expect(ids(children(reordered.map, "towns000"))).toEqual(["tavern00", "inner000"]);
  });

  it("no cycles: refuses moving a folder into itself or a descendant, tree unchanged", () => {
    const map = fixture();
    expect(move(map, "towns000", { parentId: "towns000" }).ok).toBe(false);
    expect(move(map, "towns000", { parentId: "inner000" }).ok).toBe(false);
    expect(map).toEqual(fixture());
  });

  it("refuses a non-folder target, unknown features and self-relative placement", () => {
    expect(move(fixture(), "tavern00", { parentId: "lonely00" }).ok).toBe(false);
    expect(move(fixture(), "missing0", { parentId: null }).ok).toBe(false);
    expect(move(fixture(), "lonely00", { parentId: null, after: "lonely00" }).ok).toBe(false);
  });
});

describe("update", () => {
  it("shallow-merges fields and merges style one level deep", () => {
    const res = ok(update(fixture(), "tavern00", { name: "Prancing Pony", style: { iconColor: "#00ff00", iconShape: undefined } }));
    const f = getFeature(res.map, "tavern00")!;
    expect(f.name).toBe("Prancing Pony");
    expect(f.style).toEqual({ iconColor: "#00ff00" });
    expect(validateMap(res.map).ok).toBe(true);
  });

  it("removes keys patched to undefined, including style", () => {
    const res = ok(update(fixture(), "tavern00", { style: undefined }));
    expect("style" in getFeature(res.map, "tavern00")!).toBe(false);
    const named = ok(update(fixture(), "lonely00", { name: undefined }));
    expect("name" in getFeature(named.map, "lonely00")!).toBe(false);
  });

  it("refuses changing id, type or parentId, but allows the same values", () => {
    expect(update(fixture(), "lonely00", { id: "other000" }).ok).toBe(false);
    expect(update(fixture(), "lonely00", { type: "label" }).ok).toBe(false);
    expect(update(fixture(), "lonely00", { parentId: "towns000" }).ok).toBe(false);
    expect(update(fixture(), "lonely00", { id: "lonely00", type: "pin", name: "x" }).ok).toBe(true);
    expect(update(fixture(), "missing0", { name: "x" }).ok).toBe(false);
  });
});

describe("deleteSubtree / restore", () => {
  it("deleting a folder with children removes the folder and all descendants", () => {
    const res = ok(deleteSubtree(fixture(), "towns000"));
    expect(ids(res.removed)).toEqual(["towns000", "inner000", "deep0000", "tavern00"]);
    expect(ids(res.map.features)).toEqual(["lonely00", "river000"]);
    expect(validateMap(res.map).ok).toBe(true);
  });

  it("deletes a single leaf", () => {
    const res = ok(deleteSubtree(fixture(), "lonely00"));
    expect(ids(res.removed)).toEqual(["lonely00"]);
    expect(deleteSubtree(fixture(), "missing0").ok).toBe(false);
  });

  it("restore re-adds removed features unchanged", () => {
    const map = fixture();
    const del = ok(deleteSubtree(map, "towns000"));
    const back = ok(restore(del.map, del.removed));
    for (const f of map.features) expect(getFeature(back.map, f.id)).toEqual(f);
    expect(back.map.features).toHaveLength(map.features.length);
    expect(ids(children(back.map, null))).toEqual(ids(children(map, null)));
    expect(validateMap(back.map).ok).toBe(true);
  });

  it("restore refuses duplicates and dangling parents", () => {
    const del = ok(deleteSubtree(fixture(), "inner000"));
    expect(restore(fixture(), del.removed).ok).toBe(false);
    const orphan = del.removed.filter((f) => f.id === "deep0000");
    expect(restore(del.map, orphan).ok).toBe(false);
  });
});

describe("immutability", () => {
  it("never mutates inputs", () => {
    const map = fixture();
    const snapshot = structuredClone(map);
    const patch = { style: { iconColor: "#123456" } };
    const newFeature = { type: "pin" as const, pos: [0, 0] as [number, number] };
    const patchSnap = structuredClone(patch);
    const newSnap = structuredClone(newFeature);

    insert(map, newFeature, { parentId: "towns000", after: "inner000" });
    move(map, "lonely00", { parentId: "inner000" });
    update(map, "tavern00", patch);
    update(map, "tavern00", { style: undefined, name: undefined });
    const del = ok(deleteSubtree(map, "towns000"));
    const removedSnap = structuredClone(del.removed);
    restore(del.map, del.removed);
    children(map, null);
    descendants(map, "towns000");
    ancestors(map, "deep0000");
    effectiveHidden(map, "deep0000");
    isVisible(map, "deep0000", 1, 0, 4);

    expect(map).toEqual(snapshot);
    expect(patch).toEqual(patchSnap);
    expect(newFeature).toEqual(newSnap);
    expect(del.removed).toEqual(removedSnap);
  });
});
