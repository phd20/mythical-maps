import { describe, expect, it, vi } from "vitest";
import { HISTORY_LIMIT, LOCKED_ERROR, MapStore } from "./document";
import type { Change, Op } from "./document";
import { getFeature } from "./features";
import { rankAfter, rankBefore } from "./ids";
import type { MapDocument } from "./schema";

const r1 = rankBefore(null);
const r2 = rankAfter(r1);

function fixture(): MapDocument {
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "maps/world.png", width: 4096, height: 3072 },
    features: [
      { id: "towns000", type: "folder", name: "Towns", rank: r1 },
      { id: "tavern00", type: "pin", name: "Tavern", parentId: "towns000", rank: r1, pos: [10, 20], link: "Tavern" },
      { id: "lonely00", type: "pin", name: "Lonely", rank: r2, pos: [1, 2], style: { iconColor: "red" } },
    ],
  };
}

describe("MapStore lock", () => {
  it("refuses a locked drag: map unchanged, no notification", () => {
    const store = new MapStore(fixture());
    const before = store.map;
    const listener = vi.fn();
    store.subscribe(listener);
    store.lock();
    expect(store.isLocked).toBe(true);
    const result = store.apply({ type: "move", id: "lonely00", placement: { parentId: "towns000" } });
    expect(result).toEqual({ ok: false, error: LOCKED_ERROR });
    const drag = store.apply({ type: "update", id: "lonely00", patch: { pos: [50, 60] } });
    expect(drag.ok).toBe(false);
    expect(store.map).toBe(before);
    expect(store.dirty).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it("refuses every edit op, undo and redo while locked", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "update", id: "lonely00", patch: { name: "A" } });
    store.apply({ type: "update", id: "lonely00", patch: { name: "B" } });
    store.undo();
    store.lock();
    const map = store.map;
    const ops: Op[] = [
      { type: "insert", feature: { type: "pin", pos: [0, 0] } },
      { type: "delete", id: "lonely00" },
      { type: "setViewport", viewport: { center: [0, 0], zoom: 1 } },
      { type: "setImage", image: { path: "x.png", width: 1, height: 1 } },
    ];
    for (const op of ops) {
      expect(store.apply(op)).toEqual({ ok: false, error: LOCKED_ERROR });
    }
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.map).toBe(map);
    store.unlock();
    expect(store.isLocked).toBe(false);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(true);
    expect(store.apply({ type: "move", id: "lonely00", placement: { parentId: "towns000" } }).ok).toBe(true);
  });
});

describe("MapStore apply", () => {
  it("delegates to features.ts and returns its errors unchanged", () => {
    const store = new MapStore(fixture());
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.apply({ type: "delete", id: "missing0" })).toEqual({ ok: false, error: 'feature "missing0" does not exist' });
    expect(store.apply({ type: "move", id: "towns000", placement: { parentId: "tavern00" } }).ok).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(store.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it("returns the new id for insert", () => {
    const store = new MapStore(fixture());
    const result = store.apply({ type: "insert", feature: { type: "pin", pos: [3, 4] }, placement: { parentId: "towns000" } });
    expect(result.ok).toBe(true);
    expect(typeof result.id).toBe("string");
    expect(getFeature(store.map, result.id!)?.parentId).toBe("towns000");
  });

  it("sets and clears the viewport and sets the image", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "setViewport", viewport: { center: [1, 2], zoom: 3 } });
    expect(store.map.viewport).toEqual({ center: [1, 2], zoom: 3 });
    store.apply({ type: "setViewport", viewport: undefined });
    expect("viewport" in store.map).toBe(false);
    store.apply({ type: "setImage", image: { path: "b.png", width: 2, height: 3 } });
    expect(store.map.image).toEqual({ path: "b.png", width: 2, height: 3 });
  });
});

describe("MapStore undo/redo", () => {
  it("undoing a delete restores the same id and properties", () => {
    const store = new MapStore(fixture());
    const original = getFeature(store.map, "lonely00");
    expect(store.apply({ type: "delete", id: "lonely00" }).ok).toBe(true);
    expect(getFeature(store.map, "lonely00")).toBeUndefined();
    expect(store.undo()).toBe(true);
    expect(getFeature(store.map, "lonely00")).toEqual(original);
    expect(store.map).toEqual(fixture());
  });

  it("undoing a folder delete restores the whole subtree", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "delete", id: "towns000" });
    expect(store.map.features.map((f) => f.id)).toEqual(["lonely00"]);
    store.undo();
    expect(store.map).toEqual(fixture());
  });

  it("redo re-applies the undone op", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "delete", id: "lonely00" });
    const afterDelete = store.map;
    store.undo();
    expect(store.canRedo).toBe(true);
    expect(store.redo()).toBe(true);
    expect(store.map).toBe(afterDelete);
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.undo()).toBe(true);
    expect(getFeature(store.map, "lonely00")).toBeDefined();
  });

  it("returns false when there is nothing to undo", () => {
    const store = new MapStore(fixture());
    expect(store.canUndo).toBe(false);
    expect(store.undo()).toBe(false);
  });

  it("a new op clears the redo stack", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "update", id: "lonely00", patch: { name: "A" } });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.apply({ type: "update", id: "lonely00", patch: { name: "B" } });
    expect(store.canRedo).toBe(false);
    expect(store.redo()).toBe(false);
    expect(getFeature(store.map, "lonely00")?.name).toBe("B");
  });

  it("caps history at HISTORY_LIMIT entries, dropping the oldest", () => {
    const store = new MapStore(fixture());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      store.apply({ type: "update", id: "lonely00", patch: { name: `n${i}` } });
    }
    let undos = 0;
    while (store.undo()) undos++;
    expect(undos).toBe(HISTORY_LIMIT);
    expect(getFeature(store.map, "lonely00")?.name).toBe("n4");
  });
});

describe("MapStore replace", () => {
  it("clears history, works while locked and is not an undoable edit", () => {
    const store = new MapStore(fixture());
    store.apply({ type: "update", id: "lonely00", patch: { name: "A" } });
    store.apply({ type: "update", id: "lonely00", patch: { name: "B" } });
    store.undo();
    store.lock();
    const fromDisk: MapDocument = { ...fixture(), features: [] };
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.apply({ type: "replace", map: fromDisk })).toEqual({ ok: true, map: fromDisk });
    expect(store.map).toBe(fromDisk);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![1]).toEqual({ op: { type: "replace", map: fromDisk }, kind: "replace" });
    store.unlock();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.map).toBe(fromDisk);
  });
});

describe("MapStore subscribe", () => {
  it("fires once per change with the kind, and unsubscribe stops it", () => {
    const store = new MapStore(fixture());
    const changes: Change[] = [];
    const maps: MapDocument[] = [];
    const unsubscribe = store.subscribe((map, change) => {
      maps.push(map);
      changes.push(change);
    });
    const op: Op = { type: "delete", id: "lonely00" };
    store.apply(op);
    store.undo();
    store.redo();
    expect(changes).toEqual([{ op, kind: "apply" }, { kind: "undo" }, { kind: "redo" }]);
    expect(maps[2]).toBe(store.map);
    unsubscribe();
    store.undo();
    expect(changes).toHaveLength(3);
  });

  it("does not notify on a failed undo or refused op", () => {
    const store = new MapStore(fixture());
    const listener = vi.fn();
    store.subscribe(listener);
    store.undo();
    store.redo();
    store.apply({ type: "update", id: "lonely00", patch: { type: "label" } });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("MapStore dirty", () => {
  it("tracks apply/undo/redo since construction or markSaved", () => {
    const store = new MapStore(fixture());
    expect(store.dirty).toBe(false);
    store.apply({ type: "update", id: "lonely00", patch: { name: "A" } });
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
    store.undo();
    expect(store.dirty).toBe(true);
    store.markSaved();
    store.redo();
    expect(store.dirty).toBe(true);
    store.markSaved();
    store.apply({ type: "replace", map: fixture() });
    expect(store.dirty).toBe(false);
  });
});
