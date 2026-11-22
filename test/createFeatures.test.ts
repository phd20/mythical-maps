import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App, Menu, MockElement, TFile, WorkspaceLeaf } from "./mocks/obsidian";
import { ADD_PIN_HERE, LOCKED_NOTICE, MapView } from "../src/obsidian/mapView";
import type { BaseMapHandle, BaseMapOptions } from "../src/ui/baseMap";
import { creationKindFor, EDIT_MODES, MODE_BUTTONS, FIT_BUTTON } from "../src/ui/toolbar";
import { children } from "../src/core/features";

const MAP = readFileSync(fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url)), "utf8");

function open() {
  const view = new MapView(new WorkspaceLeaf(new App()) as never);
  const mounts: { options: BaseMapOptions; fits: number }[] = [];
  view.mountMap = (_parent, options) => {
    const m = { options, fits: 0 };
    mounts.push(m);
    return { refresh() {}, destroy() {}, render() {}, fit: () => m.fits++, currentViewport: () => null } as unknown as BaseMapHandle;
  };
  const notices: string[] = [];
  view.notify = (m) => notices.push(m);
  (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(new TFile("Maps/all-types.map"), MAP);
  const pointer = () => mounts.at(-1)!.options.pointer!;
  const ev = (shiftKey = false) => ({ shiftKey }) as MouseEvent;
  return { view, mounts, notices, pointer, ev, content: view.contentEl as unknown as MockElement };
}

const toolbarButtons = (content: MockElement) =>
  content.findAll((e) => e.hasClass("mythical-map-toolbar"))[0]!.findAll((e) => e.tag === "button");

describe("creationKindFor", () => {
  it("maps modes and Shift", () => {
    expect(creationKindFor("pin", false)).toBe("pin");
    expect(creationKindFor("label", false)).toBe("label");
    expect(creationKindFor("select", false)).toBeNull();
    expect(creationKindFor("region", false)).toBeNull();
    expect(creationKindFor("path", false)).toBeNull();
    for (const mode of EDIT_MODES) expect(creationKindFor(mode, true)).toBe("pin");
  });
});

describe("toolbar", () => {
  it("renders the five modes and Fit, with Select active", () => {
    const { content } = open();
    const buttons = toolbarButtons(content);
    expect(buttons.map((b) => b.attributes["aria-label"])).toEqual([
      ...EDIT_MODES.map((m) => MODE_BUTTONS[m].title),
      FIT_BUTTON.title,
    ]);
    expect(buttons[0]?.hasClass("is-active")).toBe(true);
    expect(buttons[1]?.icon).toBe("map-pin");
  });

  it("switches mode on click and keeps it across re-renders", () => {
    const { view, content } = open();
    const buttons = toolbarButtons(content);
    buttons[1]?.click();
    expect(view.editMode).toBe("pin");
    expect(buttons[1]?.hasClass("is-active")).toBe(true);
    expect(buttons[0]?.hasClass("is-active")).toBe(false);
    expect(content.hasClass("mythical-map-mode-pin")).toBe(true);
    view.setEditMode("label");
    expect(content.hasClass("mythical-map-mode-pin")).toBe(false);
    expect(content.hasClass("mythical-map-mode-label")).toBe(true);
  });

  it("Fit calls the base map's fit", () => {
    const { content, mounts } = open();
    toolbarButtons(content).at(-1)?.click();
    expect(mounts[0]?.fits).toBe(1);
  });
});

describe("creating features", () => {
  it("creates and selects a pin in Pin mode, last at the root, saved", () => {
    const { view, pointer, ev } = open();
    view.setEditMode("pin");
    pointer().onClick?.([-10, 20], ev());
    const store = view.mapStore!;
    const created = children(store.map, null).at(-1)!;
    expect(created).toMatchObject({ type: "pin", pos: [-10, 20] });
    expect(created.style).toBeUndefined();
    expect(view.selectedId).toBe(created.id);
    expect(store.dirty).toBe(true);
  });

  it("creates a label in Label mode", () => {
    const { view, pointer, ev } = open();
    view.setEditMode("label");
    pointer().onClick?.([-1, 2], ev());
    expect(view.mapStore!.map.features.at(-1)).toMatchObject({ type: "label", pos: [-1, 2] });
  });

  it("creates nothing in Select, Region and Path modes", () => {
    const { view, pointer, ev } = open();
    const before = view.mapStore!.map.features.length;
    for (const mode of ["select", "region", "path"] as const) {
      view.setEditMode(mode);
      pointer().onClick?.([0, 0], ev());
    }
    expect(view.mapStore!.map.features).toHaveLength(before);
  });

  it("Shift-click adds a pin in Select mode", () => {
    const { view, pointer, ev } = open();
    pointer().onClick?.([-3, 4], ev(true));
    expect(view.mapStore!.map.features.at(-1)).toMatchObject({ type: "pin", pos: [-3, 4] });
  });

  it("goes into the selected folder as its last child", () => {
    const { view, pointer, ev } = open();
    view.setSelected("ftowns01");
    view.setEditMode("pin");
    pointer().onClick?.([-5, 5], ev());
    const kids = children(view.mapStore!.map, "ftowns01");
    expect(kids.at(-1)?.id).toBe(view.selectedId);
    expect(kids.at(-1)).toMatchObject({ pos: [-5, 5] });
  });

  it("offers Add pin here in the context menu", () => {
    const { view, pointer } = open();
    const shown: Menu[] = [];
    const orig = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function (this: Menu, e: unknown) {
      shown.push(this);
      return orig.call(this, e);
    };
    try {
      pointer().onContextMenu?.([-7, 8], {} as MouseEvent);
    } finally {
      Menu.prototype.showAtMouseEvent = orig;
    }
    const item = shown[0]?.items[0];
    expect(item?.title).toBe(ADD_PIN_HERE);
    item?.clickHandler?.({});
    expect(view.mapStore!.map.features.at(-1)).toMatchObject({ type: "pin", pos: [-7, 8] });
  });

  it("is refused while locked: nothing is created, a notice shows", () => {
    const { view, pointer, ev, notices } = open();
    view.setLocked(true);
    view.setEditMode("pin");
    const before = view.mapStore!.map.features.length;
    pointer().onClick?.([0, 0], ev());
    expect(view.mapStore!.map.features).toHaveLength(before);
    expect(notices).toContain(LOCKED_NOTICE);
    expect(view.selectedId).toBeNull();
  });

  it("drops the selection when its feature is deleted, and undo of the create clears it", () => {
    const { view, pointer, ev } = open();
    view.setEditMode("pin");
    pointer().onClick?.([0, 0], ev());
    const id = view.selectedId!;
    const changes: Array<string | null> = [];
    view.onSelectionChange((s) => changes.push(s));
    view.undo();
    expect(view.mapStore!.map.features.some((f) => f.id === id)).toBe(false);
    expect(view.selectedId).toBeNull();
    expect(changes).toEqual([null]);
  });

  it("is in edit mode (clicks select) while unlocked only", () => {
    const { view } = open();
    expect(view.isEditing()).toBe(true);
    view.setLocked(true);
    expect(view.isEditing()).toBe(false);
  });
});
