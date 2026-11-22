import { beforeAll, describe, expect, it } from "vitest";
import { MockElement } from "./mocks/obsidian";
import { MapStore, type ApplyResult } from "../src/core/document";
import type { Feature, MapDocument } from "../src/core/schema";
import { FeaturePanel, NEW_FOLDER_NAME, type FeaturePanelHost } from "../src/ui/featurePanel";
import type { EditOp } from "../src/obsidian/mapView";

// The shared mock element is minimal; add the few DOM members the panel touches.
beforeAll(() => {
  const proto = MockElement.prototype as unknown as Record<string, unknown>;
  for (const name of ["focus", "select", "remove", "removeClass"]) proto[name] ??= function () {};
});

const pin = (id: string, rank: string, parentId?: string): Feature =>
  ({ id, type: "pin", rank, name: id, pos: [1, 1], ...(parentId ? { parentId } : {}) }) as Feature;
const folder = (id: string, rank: string, parentId?: string): Feature =>
  ({ id, type: "folder", rank, name: id, ...(parentId ? { parentId } : {}) }) as Feature;
const doc = (features: Feature[]): MapDocument =>
  ({ type: "mythical-map", version: 1, image: { path: "a.png", width: 10, height: 10 }, features }) as unknown as MapDocument;

function setup(features: Feature[]) {
  const store = new MapStore(doc(features));
  const ops: EditOp[] = [];
  const selected: string[] = [];
  const notices: string[] = [];
  const parent = new MockElement() as unknown as HTMLElement;
  const host: FeaturePanelHost = {
    edit: (op): ApplyResult => {
      ops.push(op);
      return store.apply(op);
    },
    select: (id) => selected.push(id),
    notify: (m) => notices.push(m),
  };
  const panel = new FeaturePanel(parent, host);
  store.subscribe((map) => panel.update(map));
  panel.update(store.map);
  const root = panel.el as unknown as MockElement;
  const rows = () => root.findAll((e) => e.classes.has("mythical-map-panel-row"));
  const names = () => rows().map((r) => r.findAll((e) => e.classes.has("mythical-map-panel-name"))[0]?.text);
  return { store, panel, ops, selected, notices, root, rows, names };
}

describe("FeaturePanel", () => {
  it("lists features as a tree ordered by rank", () => {
    const t = setup([pin("pinZ", "a2"), folder("towns", "a0"), pin("inn", "a1", "towns"), pin("deep", "a0", "towns")]);
    expect(t.names()).toEqual(["towns", "deep", "inn", "pinZ"]);
  });

  it("selects on row click and marks the selected row from outside", () => {
    const t = setup([pin("pinZ", "a0"), pin("other", "a1")]);
    t.rows()[1]?.click();
    expect(t.selected).toEqual(["other"]);
    expect(t.rows()[1]?.classes.has("is-selected")).toBe(true);
    t.panel.setSelected("pinZ");
    expect(t.rows()[0]?.classes.has("is-selected")).toBe(true);
    expect(t.rows()[1]?.classes.has("is-selected")).toBe(false);
  });

  it("toggles isHidden with the eye button", () => {
    const t = setup([pin("pinZ", "a0")]);
    const eye = () => t.root.findAll((e) => e.classes.has("mythical-map-panel-eye"))[0];
    eye()?.click();
    expect(t.store.map.features[0]?.isHidden).toBe(true);
    expect(t.rows()[0]?.classes.has("is-hidden")).toBe(true);
    eye()?.click();
    expect(t.store.map.features[0]).not.toHaveProperty("isHidden");
  });

  it("creates a folder in the selected folder and starts renaming it", () => {
    const t = setup([folder("towns", "a0"), pin("pinZ", "a1")]);
    t.panel.setSelected("towns");
    t.panel.createFolder();
    const created = t.store.map.features.find((f) => f.id !== "towns" && f.id !== "pinZ");
    expect(created?.type).toBe("folder");
    expect(created?.name).toBe(NEW_FOLDER_NAME);
    expect(created?.parentId).toBe("towns");
    expect(t.selected).toEqual([created?.id]);
    const input = t.root.findAll((e) => e.classes.has("mythical-map-panel-rename"))[0];
    expect(input).toBeDefined();
  });

  it("renames a folder on Enter and keeps the name on an empty rename off", () => {
    const t = setup([folder("towns", "a0")]);
    t.panel.beginRename("towns");
    const input = t.root.findAll((e) => e.classes.has("mythical-map-panel-rename"))[0] as MockElement & { value: string };
    input.value = "  Cities ";
    for (const cb of input.listeners.keydown ?? []) cb({ key: "Enter", stopPropagation() {} });
    expect(t.store.map.features[0]?.name).toBe("Cities");
  });

  it("moves a pin into a folder as its last child", () => {
    const t = setup([folder("towns", "a0"), pin("old", "a1", "towns"), pin("pinZ", "a2")]);
    expect(t.panel.drop("pinZ", "towns", "inside")).toBe(true);
    const moved = t.store.map.features.find((f) => f.id === "pinZ");
    const old = t.store.map.features.find((f) => f.id === "old");
    expect(moved?.parentId).toBe("towns");
    expect((moved?.rank ?? "") > (old?.rank ?? "")).toBe(true);
  });

  it("refuses to drop a folder into its own descendant and leaves the tree unchanged", () => {
    const t = setup([folder("towns", "a0"), folder("inner", "a0", "towns"), pin("deep", "a0", "inner")]);
    const before = t.store.map;
    expect(t.panel.drop("towns", "inner", "inside")).toBe(false);
    expect(t.panel.drop("towns", "deep", "before")).toBe(false);
    expect(t.store.map).toBe(before);
    expect(t.ops).toEqual([]);
    expect(t.notices.length).toBe(2);
  });

  it("goes through the store's lock", () => {
    const t = setup([folder("towns", "a0"), pin("pinZ", "a1")]);
    t.store.lock();
    expect(t.panel.drop("pinZ", "towns", "inside")).toBe(false);
    expect(t.store.map.features.find((f) => f.id === "pinZ")?.parentId).toBeUndefined();
  });
});
