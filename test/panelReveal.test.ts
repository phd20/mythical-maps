import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App, MockElement, TFile, WorkspaceLeaf } from "./mocks/obsidian";
import { MapView } from "../src/obsidian/mapView";
import { MapPanelView } from "../src/obsidian/panelView";
import type { BaseMapHandle } from "../src/ui/baseMap";
import { featureCenter } from "../src/core/features";

const MAP = readFileSync(fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url)), "utf8");

const proto = MockElement.prototype as unknown as Record<string, unknown>;
for (const name of ["focus", "select", "remove", "removeClass"]) proto[name] ??= function () {};

function open() {
  const app = new App();
  const leaf = new WorkspaceLeaf(app);
  const view = new MapView(leaf as never);
  const centred: unknown[] = [];
  view.mountMap = () =>
    ({
      refresh() {},
      destroy() {},
      render() {},
      currentViewport: () => null,
      centerOn: (pos: unknown) => centred.push(pos),
    }) as unknown as BaseMapHandle;
  (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(new TFile("Maps/all-types.map"), MAP);
  leaf.view = view as never;
  app.workspace.mostRecentLeaf = leaf;
  const sidebar = new MapPanelView(new WorkspaceLeaf(app) as never);
  void sidebar.onOpen();
  const content = sidebar.contentEl as unknown as MockElement;
  const rows = () => content.findAll((e) => e.classes.has("mythical-map-panel-row"));
  const features = view.mapStore!.map.features;
  /** Click the row showing the first feature of `type`. */
  const clickRow = (type: string) => {
    const feature = features.find((f) => f.type === type)!;
    const row = rows().find((r) => r.findAll((e) => e.textContent === feature.name).length > 0)!;
    row.click();
    return feature;
  };
  return { view, centred, clickRow };
}

describe("reveal from the feature panel", () => {
  it.each(["pin", "region", "path"])("selects and centres on a %s", (type) => {
    const { view, centred, clickRow } = open();
    const feature = clickRow(type);
    expect(view.selectedId).toBe(feature.id);
    expect(centred).toEqual([featureCenter(feature)]);
  });

  it("selects a folder without moving the view", () => {
    const { view, centred, clickRow } = open();
    const folder = clickRow("folder");
    expect(view.selectedId).toBe(folder.id);
    expect(centred).toEqual([]);
  });

  it("does not move the view when selected from the map", () => {
    const { view, centred } = open();
    view.selectFeature(view.mapStore!.map.features.find((f) => f.type === "pin")!.id);
    expect(centred).toEqual([]);
  });
});
