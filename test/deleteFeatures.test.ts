import { describe, expect, it } from "vitest";
import { App, Menu, MockElement, Modal, Scope, TFile, WorkspaceLeaf } from "./mocks/obsidian";
import { MapView, DELETE_FEATURE, LOCKED_NOTICE } from "../src/obsidian/mapView";
import {
  CANCEL_BUTTON_TEXT,
  confirmDelete,
  DELETE_BUTTON_TEXT,
  DeleteConfirmModal,
  deleteConfirmMessage,
} from "../src/obsidian/deleteConfirmModal";
import type { BaseMapHandle, BaseMapOptions } from "../src/ui/baseMap";
import type { MapDocument } from "../src/core/schema";

const MAP = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "Maps/x.png", width: 100, height: 100 },
  features: [
    { id: "ftowns01", type: "folder", name: "Towns", rank: "a0" },
    { id: "pinn0001", type: "pin", name: "Inn", pos: [-1, 1], parentId: "ftowns01", rank: "a0" },
    { id: "pforge01", type: "pin", name: "Forge", pos: [-2, 2], parentId: "ftowns01", rank: "a1" },
    { id: "pstray01", type: "pin", name: "Stray", pos: [-3, 3], rank: "a1" },
    { id: "fempty01", type: "folder", name: "Empty", rank: "a2" },
  ],
});

function setup() {
  const app = new App();
  const view = new MapView(new WorkspaceLeaf(app) as never);
  const options: BaseMapOptions[] = [];
  view.mountMap = (_parent, o) => {
    options.push(o);
    return { refresh() {}, destroy() {}, render() {}, currentViewport: () => null } as unknown as BaseMapHandle;
  };
  const notices: string[] = [];
  view.notify = (m) => notices.push(m);
  const asked: Array<[string, number]> = [];
  let answer = true;
  view.confirmFolderDelete = (name, count) => {
    asked.push([name, count]);
    return Promise.resolve(answer);
  };
  (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(new TFile("Maps/t.map"), MAP);
  const ids = () => (view.mapState.kind === "ok" ? view.mapState.map.features.map((f) => f.id) : []);
  return { app, view, options, notices, asked, ids, setAnswer: (a: boolean) => (answer = a) };
}

const scopeOf = (view: MapView) => view.scope as unknown as Scope;

describe("deleteFeature (bead 5.6)", () => {
  it("deletes a leaf without confirmation, clears the selection and supports undo", async () => {
    const t = setup();
    t.view.setSelection("pstray01");
    expect(await t.view.deleteFeature("pstray01")).toBe(true);
    expect(t.asked).toEqual([]);
    expect(t.ids()).not.toContain("pstray01");
    expect(t.view.selection).toBeNull();
    expect(t.view.undo()).toBe(true);
    expect(t.ids()).toContain("pstray01");
  });

  it("deletes an empty folder without confirmation", async () => {
    const t = setup();
    expect(await t.view.deleteFeature("fempty01")).toBe(true);
    expect(t.asked).toEqual([]);
    expect(t.ids()).not.toContain("fempty01");
  });

  it("asks with the descendant count, then cascades on confirm; undo restores the subtree", async () => {
    const t = setup();
    expect(await t.view.deleteFeature("ftowns01")).toBe(true);
    expect(t.asked).toEqual([["Towns", 2]]);
    expect(t.ids()).toEqual(["pstray01", "fempty01"]);
    expect(t.view.undo()).toBe(true);
    expect(t.ids()).toHaveLength(5);
  });

  it("removes nothing when the confirmation is cancelled", async () => {
    const t = setup();
    t.setAnswer(false);
    expect(await t.view.deleteFeature("ftowns01")).toBe(false);
    expect(t.ids()).toHaveLength(5);
    expect(t.view.canUndo).toBe(false);
  });

  it("is refused with a notice while locked, without asking", async () => {
    const t = setup();
    t.view.setLocked(true);
    expect(await t.view.deleteFeature("ftowns01")).toBe(false);
    expect(await t.view.deleteFeature("pstray01")).toBe(false);
    expect(t.asked).toEqual([]);
    expect(t.notices).toEqual([LOCKED_NOTICE, LOCKED_NOTICE]);
    expect(t.ids()).toHaveLength(5);
  });

  it("ignores unknown ids", async () => {
    const t = setup();
    expect(await t.view.deleteFeature("nope0000")).toBe(false);
    expect(t.notices).toEqual([]);
  });
});

describe("Delete key", () => {
  it("deletes the selection and is registered on Delete and Backspace in the view scope", async () => {
    const t = setup();
    t.view.setSelection("pstray01");
    expect(scopeOf(t.view).trigger([], "Delete", { target: { tagName: "DIV" } })).toBe(false);
    await Promise.resolve();
    expect(t.ids()).not.toContain("pstray01");
    t.view.setSelection("pforge01");
    expect(scopeOf(t.view).trigger([], "Backspace", {})).toBe(false);
    await Promise.resolve();
    expect(t.ids()).not.toContain("pforge01");
  });

  it("does nothing in text fields or with no selection", async () => {
    const t = setup();
    t.view.setSelection("pstray01");
    expect(scopeOf(t.view).trigger([], "Delete", { target: { tagName: "INPUT" } })).toBe(true);
    expect(scopeOf(t.view).trigger([], "Delete", { target: { isContentEditable: true } })).toBe(true);
    t.view.setSelection(null);
    expect(scopeOf(t.view).trigger([], "Delete", {})).toBe(true);
    await Promise.resolve();
    expect(t.ids()).toHaveLength(5);
  });

  it("asks before deleting a selected folder with children", async () => {
    const t = setup();
    t.setAnswer(false);
    t.view.setSelection("ftowns01");
    scopeOf(t.view).trigger([], "Delete", {});
    await Promise.resolve();
    await Promise.resolve();
    expect(t.asked).toEqual([["Towns", 2]]);
    expect(t.ids()).toHaveLength(5);
  });
});

describe("context menus", () => {
  function captureMenu(fn: () => void): Menu[] {
    const shown: Menu[] = [];
    const original = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function (this: Menu, e: unknown) {
      shown.push(this);
      return original.call(this, e);
    };
    try {
      fn();
    } finally {
      Menu.prototype.showAtMouseEvent = original;
    }
    return shown;
  }

  it("the map feature menu offers Delete, and the map menu skips the same event", async () => {
    const t = setup();
    const hooks = t.options[0]?.interactions;
    const pointer = t.options[0]?.pointer;
    const feature = (t.view.mapState as { map: MapDocument }).map.features.find((f) => f.id === "pstray01")!;
    const event = { preventDefault() {} } as unknown as MouseEvent;
    const shown = captureMenu(() => {
      hooks?.onContextMenu?.(feature, event);
      pointer?.onContextMenu?.([0, 0], event);
    });
    expect(shown).toHaveLength(1);
    expect(shown[0]?.items.map((i) => i.title)).toEqual([DELETE_FEATURE]);
    shown[0]?.items[0]?.clickHandler?.({});
    await Promise.resolve();
    expect(t.ids()).not.toContain("pstray01");
  });

  it("panel rows offer Delete on right-click", async () => {
    const t = setup();
    const content = t.view.contentEl as unknown as MockElement;
    const row = content.findAll((e) => e.attributes["data-feature-id"] === "pinn0001")[0];
    const shown = captureMenu(() => {
      for (const cb of row?.listeners.contextmenu ?? []) cb({ preventDefault() {} });
    });
    expect(shown).toHaveLength(1);
    shown[0]?.items[0]?.clickHandler?.({});
    await Promise.resolve();
    expect(t.ids()).not.toContain("pinn0001");
  });
});

describe("DeleteConfirmModal", () => {
  it("shows the count and resolves true on Delete", async () => {
    const before = Modal.opened.length;
    const promise = confirmDelete(new App() as never, "Towns", 2);
    const modal = Modal.opened[before] as unknown as DeleteConfirmModal;
    const content = modal.contentEl as unknown as MockElement;
    expect(content.textContent).toContain(deleteConfirmMessage("Towns", 2));
    expect(deleteConfirmMessage("Towns", 1)).toContain("1 feature ");
    content.findAll((e) => e.text === DELETE_BUTTON_TEXT)[0]?.click();
    expect(await promise).toBe(true);
  });

  it("resolves false on Cancel and on any other close", async () => {
    const before = Modal.opened.length;
    const a = confirmDelete(new App() as never, "Towns", 2);
    const content = Modal.opened[before]!.contentEl as unknown as MockElement;
    content.findAll((e) => e.text === CANCEL_BUTTON_TEXT)[0]?.click();
    expect(await a).toBe(false);
    const b = confirmDelete(new App() as never, "Towns", 2);
    Modal.opened[before + 1]!.close();
    expect(await b).toBe(false);
  });
});
