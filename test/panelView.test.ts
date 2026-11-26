import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App, MockElement, TFile, WorkspaceLeaf } from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { MapView, SHOW_PANEL_TITLE, TOGGLE_LOCK_COMMAND_ID } from "../src/obsidian/mapView";
import { MapPanelView, NO_MAP_TEXT, registerMapPanel, SHOW_PANEL_COMMAND_ID, VIEW_TYPE_PANEL } from "../src/obsidian/panelView";
import { VIEW_TYPE_MAP } from "../src/obsidian/constants";
import type { BaseMapHandle } from "../src/ui/baseMap";

const MAP = readFileSync(fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url)), "utf8");
const SMALL = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "a.png", width: 10, height: 10 },
  features: [{ id: "psolo001", type: "pin", name: "Solo", rank: "a0", pos: [-1, 1] }],
});

const proto = MockElement.prototype as unknown as Record<string, unknown>;
for (const name of ["focus", "select", "remove", "removeClass"]) proto[name] ??= function () {};
proto.setText ??= function (this: MockElement, text: string) {
  this.text = text;
};

function mapLeaf(app: App, path: string, data: string) {
  const leaf = new WorkspaceLeaf(app);
  const view = new MapView(leaf as never);
  view.mountMap = () => ({ refresh() {}, destroy() {}, render() {}, currentViewport: () => null, centerOn() {} }) as unknown as BaseMapHandle;
  view.notify = () => {};
  leaf.view = view as never;
  const load = (text = data, file = path) => (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(new TFile(file), text);
  load();
  return { leaf, view, load };
}

function setup() {
  const app = new App();
  const panel = new MapPanelView(new WorkspaceLeaf(app) as never);
  const content = panel.contentEl as unknown as MockElement;
  const names = () =>
    content.findAll((e) => e.classes.has("mythical-map-panel-name")).map((e) => e.text);
  /** Make `leaf` the most recent main-area tab, as switching tabs does. */
  const focus = (leaf: WorkspaceLeaf | null) => {
    app.workspace.mostRecentLeaf = leaf;
    app.workspace.trigger("active-leaf-change", leaf);
  };
  return { app, panel, content, names, focus };
}

describe("MapPanelView", () => {
  it("follows the most recent map, and says so when the tab is not a map", async () => {
    const t = setup();
    await t.panel.onOpen();
    expect(t.content.textContent).toBe(NO_MAP_TEXT);
    const first = mapLeaf(t.app, "Maps/all-types.map", MAP);
    const second = mapLeaf(t.app, "Maps/small.map", SMALL);
    t.focus(first.leaf);
    expect(t.names()).toContain("Westmarch");
    t.focus(second.leaf);
    expect(t.names()).toEqual(["Solo"]);
    t.focus(new WorkspaceLeaf(t.app));
    expect(t.content.textContent).toBe(NO_MAP_TEXT);
    expect(t.panel.target).toBeNull();
  });

  it("updates with the map's edits and selection, and when the tab opens another file", async () => {
    const t = setup();
    const map = mapLeaf(t.app, "Maps/small.map", SMALL);
    await t.panel.onOpen();
    t.focus(map.leaf);
    map.view.edit({ type: "update", id: "psolo001", patch: { name: "Renamed" } });
    expect(t.names()).toEqual(["Renamed"]);
    map.view.setSelection("psolo001");
    expect(t.content.findAll((e) => e.classes.has("mythical-map-panel-row") && e.classes.has("is-selected"))).toHaveLength(1);
    expect(t.content.findAll((e) => e.classes.has("mythical-map-props"))[0]!.classes.has("is-empty")).toBe(false);
    map.view.clear();
    expect(t.content.textContent).toBe(NO_MAP_TEXT);
    map.load(MAP, "Maps/all-types.map");
    expect(t.names()).toContain("Westmarch");
  });

  it("stops listening to a map it no longer shows", async () => {
    const t = setup();
    const first = mapLeaf(t.app, "Maps/small.map", SMALL);
    const second = mapLeaf(t.app, "Maps/all-types.map", MAP);
    await t.panel.onOpen();
    t.focus(first.leaf);
    t.focus(second.leaf);
    first.view.edit({ type: "update", id: "psolo001", patch: { name: "Elsewhere" } });
    expect(t.names()).not.toContain("Elsewhere");
  });

  it("deletes and undoes through its own hotkeys", async () => {
    const t = setup();
    const map = mapLeaf(t.app, "Maps/small.map", SMALL);
    await t.panel.onOpen();
    t.focus(map.leaf);
    map.view.setSelection("psolo001");
    const scope = t.panel.scope as unknown as { trigger(m: string[], k: string, e: unknown): unknown };
    expect(scope.trigger([], "Delete", { target: null })).toBe(false);
    await Promise.resolve();
    expect(t.names()).toEqual([]);
    expect(scope.trigger(["Mod"], "z", { target: null })).toBe(false);
    expect(t.names()).toEqual(["Solo"]);
    t.focus(null);
    expect(scope.trigger(["Mod"], "z", { target: null })).toBe(true);
  });
});

describe("adding the panel to the sidebar", () => {
  const settle = async (app: App) => {
    app.workspace.runLayoutReady();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const panels = (app: App) => app.workspace.getLeavesOfType(VIEW_TYPE_PANEL);

  function host(added = false) {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    const memory = { added: () => added, markAdded: async () => void (added = true) };
    return { app, hooks: registerMapPanel(plugin, app as never, memory), memory, plugin };
  }

  it("adds one tab without focus for the first map, and not again after it is closed", async () => {
    const t = host();
    t.hooks.opened();
    t.hooks.opened();
    await settle(t.app);
    expect(panels(t.app)).toHaveLength(1);
    expect(panels(t.app)[0]!.viewState).toEqual({ type: VIEW_TYPE_PANEL, active: false });
    expect(t.app.workspace.revealed).toEqual([]);
    expect(t.memory.added()).toBe(true);
    t.app.workspace.leaves.length = 0; // the user closes the tab
    t.hooks.opened();
    await settle(t.app);
    expect(panels(t.app)).toHaveLength(0);
  });

  it("reveals the existing tab, or adds it back first", async () => {
    const t = host(true);
    t.hooks.reveal();
    await settle(t.app);
    t.hooks.reveal();
    await settle(t.app);
    expect(panels(t.app)).toHaveLength(1);
    expect(t.app.workspace.revealed).toHaveLength(2);
  });

  it("is wired into the plugin: view, command, map header button, and commands while the panel has focus", async () => {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    await plugin.onload();
    const mock = plugin as unknown as {
      views: Record<string, (leaf: unknown) => unknown>;
      commands: Array<{ id: string; name: string; checkCallback?: (checking: boolean) => boolean }>;
    };
    expect(mock.commands.find((c) => c.id === SHOW_PANEL_COMMAND_ID)?.name).toBe(SHOW_PANEL_TITLE);
    const map = mapLeaf(app, "Maps/small.map", SMALL);
    const wired = mock.views[VIEW_TYPE_MAP]!(new WorkspaceLeaf(app)) as MapView;
    expect(wired.panelHost).not.toBeNull();
    const panel = mock.views[VIEW_TYPE_PANEL]!(new WorkspaceLeaf(app)) as MapPanelView;
    app.workspace.mostRecentLeaf = map.leaf;
    await panel.onOpen();
    app.workspace.activeView = panel;
    const lock = mock.commands.find((c) => c.id === TOGGLE_LOCK_COMMAND_ID)!;
    expect(lock.checkCallback!(false)).toBe(true);
    expect(map.view.isLocked).toBe(true);
  });
});
