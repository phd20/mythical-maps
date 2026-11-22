import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { App, TFile, WorkspaceLeaf } from "./mocks/obsidian";
import { LOCKED_NOTICE, MapView } from "../src/obsidian/mapView";
import type { BaseMapHandle, BaseMapOptions } from "../src/ui/baseMap";
import type { EditState } from "../src/ui/geometryEditor";
import { children, getFeature } from "../src/core/features";

const MAP = readFileSync(fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url)), "utf8");

function open() {
  const view = new MapView(new WorkspaceLeaf(new App()) as never);
  const mounts: { options: BaseMapOptions; states: EditState[] }[] = [];
  view.mountMap = (_parent, options) => {
    const m = { options, states: [] as EditState[] };
    mounts.push(m);
    return {
      refresh() {},
      destroy() {},
      render() {},
      fit() {},
      currentViewport: () => null,
      setEditState: (s: EditState) => m.states.push(s),
    } as unknown as BaseMapHandle;
  };
  const notices: string[] = [];
  view.notify = (m) => notices.push(m);
  (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(new TFile("Maps/all-types.map"), MAP);
  const geometry = () => mounts.at(-1)!.options.geometry!;
  return { view, mounts, notices, geometry };
}

const v = (lat: number, lng: number) => ({ lat, lng });

describe("view geometry hooks", () => {
  it("pushes the mode and lock state to the map on mount, mode change and lock", () => {
    const { view, mounts } = open();
    const states = mounts[0]!.states;
    expect(states.at(-1)).toEqual({ mode: "select", locked: false });
    view.setEditMode("region");
    expect(states.at(-1)).toEqual({ mode: "region", locked: false });
    view.setLocked(true);
    expect(states.at(-1)).toEqual({ mode: "region", locked: true });
  });

  it("creates and selects a region from drawn vertices, saved through the store", () => {
    const { view, geometry } = open();
    const before = view.mapStore!.map.features.length;
    geometry().createShape("region", [v(0, 0), v(0, 5), v(-5, 5)]);
    const store = view.mapStore!;
    const created = children(store.map, null).at(-1)!;
    expect(created).toMatchObject({ type: "region", polygon: [[0, 0], [0, 5], [-5, 5]] });
    expect(store.map.features).toHaveLength(before + 1);
    expect(view.selectedId).toBe(created.id);
    expect(store.dirty).toBe(true);
  });

  it("creates a path from two vertices", () => {
    const { view, geometry } = open();
    geometry().createShape("path", [v(0, 0), v(-5, 5)]);
    expect(children(view.mapStore!.map, null).at(-1)).toMatchObject({ type: "path", polyline: [[0, 0], [-5, 5]] });
  });

  it("creates nothing with too few vertices", () => {
    const { view, geometry, notices } = open();
    const before = view.mapStore!.map;
    geometry().createShape("region", [v(0, 0), v(1, 1)]);
    geometry().createShape("path", [v(0, 0)]);
    expect(view.mapStore!.map).toBe(before);
    expect(view.mapStore!.dirty).toBe(false);
    expect(notices).toHaveLength(2);
  });

  it("saves a moved pin through the store, and refuses it while locked", () => {
    const { view, geometry, notices } = open();
    const pin = view.mapStore!.map.features.find((f) => f.type === "pin")!;
    geometry().updateFeature(pin.id, { pos: [-3, 4] });
    expect(getFeature(view.mapStore!.map, pin.id)).toMatchObject({ pos: [-3, 4] });
    expect(view.mapStore!.dirty).toBe(true);

    view.setLocked(true);
    geometry().updateFeature(pin.id, { pos: [-9, 9] });
    expect(getFeature(view.mapStore!.map, pin.id)).toMatchObject({ pos: [-3, 4] });
    expect(notices).toContain(LOCKED_NOTICE);
  });
});
