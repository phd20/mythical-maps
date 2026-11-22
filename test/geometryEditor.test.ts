import { describe, expect, it } from "vitest";
import type * as L from "leaflet";
import { createGeometryEditor, type GeometryHandlers } from "../src/ui/geometryEditor";
import type { Feature, MapDocument } from "../src/core/schema";
import { map as mockMap, marker, polygon, polyline, type MockFeatureLayer } from "./mocks/leaflet";

const pt = (lat: number, lng: number) => ({ lat, lng });

function model(features: Feature[]): MapDocument {
  return { type: "mythical-map", version: 1, image: { path: "Maps/x.png", width: 100, height: 100 }, features };
}

const PIN: Feature = { id: "pin00000", type: "pin", pos: [-1, 1], rank: "a" };
const LABEL: Feature = { id: "label000", type: "label", name: "Hi", pos: [-2, 2], rank: "b" };
const REGION: Feature = { id: "region00", type: "region", polygon: [[0, 0], [0, 5], [-5, 5]], rank: "c" };
const PATH: Feature = { id: "path0000", type: "path", polyline: [[0, 0], [1, 1]], rank: "d" };
const FEATURES = [PIN, LABEL, REGION, PATH];

function setup() {
  const m = mockMap({});
  const layers: Record<string, MockFeatureLayer> = {
    pin00000: marker([-1, 1]),
    label000: marker([-2, 2]),
    region00: polygon([[[0, 0], [0, 5], [-5, 5]]]),
    path0000: polyline([[0, 0], [1, 1]]),
  };
  const created: Array<{ kind: string; vertices: unknown }> = [];
  const updates: Array<{ id: string; patch: unknown }> = [];
  const rejected: string[] = [];
  const handlers: GeometryHandlers = {
    createShape: (kind, vertices) => created.push({ kind, vertices }),
    updateFeature: (id, patch) => updates.push({ id, patch }),
    rejected: (id) => rejected.push(id),
  };
  const editor = createGeometryEditor(m as unknown as L.Map, (id) => layers[id] as unknown as L.Layer, handlers);
  return { m, layers, created, updates, rejected, editor };
}

describe("geometry editor: drawing", () => {
  it("turns Polygon draw on in Region mode and Line draw in Path mode, off otherwise", () => {
    const { m, editor } = setup();
    editor.setState({ mode: "region", locked: false });
    expect(m.drawing?.shape).toBe("Polygon");
    editor.setState({ mode: "path", locked: false });
    expect(m.drawing?.shape).toBe("Line");
    editor.setState({ mode: "select", locked: false });
    expect(m.drawing).toBeNull();
    editor.setState({ mode: "pin", locked: false });
    expect(m.drawing).toBeNull();
  });

  it("does not draw while locked, and stops drawing when locked", () => {
    const { m, editor } = setup();
    editor.setState({ mode: "region", locked: true });
    expect(m.drawing).toBeNull();
    editor.setState({ mode: "region", locked: false });
    expect(m.drawing).not.toBeNull();
    editor.setState({ mode: "region", locked: true });
    expect(m.drawing).toBeNull();
  });

  it("reports a finished region's vertices, removes Geoman's layer, and ignores nothing else", () => {
    const { m, created, editor } = setup();
    editor.setState({ mode: "region", locked: false });
    const drawn = polygon([[pt(0, 0), pt(0, 5), pt(-5, 5)]]);
    m.fire("pm:create", { layer: drawn, shape: "Polygon" });
    expect(drawn.removed).toBe(true);
    expect(created).toEqual([{ kind: "region", vertices: [pt(0, 0), pt(0, 5), pt(-5, 5)] }]);
  });

  it("reports a finished path's vertices", () => {
    const { m, created, editor } = setup();
    editor.setState({ mode: "path", locked: false });
    m.fire("pm:create", { layer: polyline([pt(0, 0), pt(1, 1)]), shape: "Line" });
    expect(created).toEqual([{ kind: "path", vertices: [pt(0, 0), pt(1, 1)] }]);
  });

  it("stops listening after destroy", () => {
    const { m, created, editor } = setup();
    editor.setState({ mode: "path", locked: false });
    editor.destroy();
    expect(m.drawing).toBeNull();
    m.fire("pm:create", { layer: polyline([pt(0, 0), pt(1, 1)]), shape: "Line" });
    expect(created).toEqual([]);
  });
});

describe("geometry editor: dragging and reshaping", () => {
  it("makes pins and labels draggable and shapes editable only in Select mode, unlocked", () => {
    const { layers, editor } = setup();
    editor.sync(model(FEATURES));
    expect(layers.pin00000!.dragging.enabled).toBe(true);
    expect(layers.label000!.dragging.enabled).toBe(true);
    expect(layers.region00!.pm.on).toBe(true);
    expect(layers.path0000!.pm.on).toBe(true);

    editor.setState({ mode: "pin", locked: false });
    expect(layers.pin00000!.dragging.enabled).toBe(false);
    expect(layers.region00!.pm.on).toBe(false);

    editor.setState({ mode: "select", locked: false });
    expect(layers.pin00000!.dragging.enabled).toBe(true);
    expect(layers.region00!.pm.on).toBe(true);
  });

  it("makes nothing draggable or editable while locked", () => {
    const { layers, editor } = setup();
    editor.setState({ mode: "select", locked: true });
    editor.sync(model(FEATURES));
    expect(layers.pin00000!.dragging.enabled).toBe(false);
    expect(layers.label000!.dragging.enabled).toBe(false);
    expect(layers.region00!.pm.on).toBe(false);
    expect(layers.path0000!.pm.on).toBe(false);
    editor.setState({ mode: "select", locked: false });
    expect(layers.pin00000!.dragging.enabled).toBe(true);
  });

  it("saves a dragged pin's final position", () => {
    const { layers, updates, editor } = setup();
    editor.sync(model(FEATURES));
    layers.pin00000!.latlngs = pt(-7, 9);
    layers.pin00000!.fire("dragend");
    expect(updates).toEqual([{ id: "pin00000", patch: { pos: [-7, 9] } }]);
  });

  it("saves a dragged label's final position", () => {
    const { layers, updates, editor } = setup();
    editor.sync(model(FEATURES));
    layers.label000!.latlngs = pt(-3, 4);
    layers.label000!.fire("dragend");
    expect(updates).toEqual([{ id: "label000", patch: { pos: [-3, 4] } }]);
  });

  it("saves a reshaped region and path from the layer's final geometry", async () => {
    const { layers, updates, editor } = setup();
    editor.sync(model(FEATURES));
    layers.region00!.latlngs = [[pt(0, 0), pt(0, 5), pt(-5, 5), pt(-5, 0)]];
    layers.region00!.fire("pm:edit");
    layers.path0000!.latlngs = [pt(0, 0), pt(1, 1), pt(2, 0)];
    layers.path0000!.fire("pm:edit");
    await Promise.resolve();
    expect(updates).toEqual([
      { id: "region00", patch: { polygon: [[0, 0], [0, 5], [-5, 5], [-5, 0]] } },
      { id: "path0000", patch: { polyline: [[0, 0], [1, 1], [2, 0]] } },
    ]);
  });

  it("rejects a reshape that leaves too few vertices instead of saving it", async () => {
    const { layers, updates, rejected, editor } = setup();
    editor.sync(model(FEATURES));
    layers.region00!.latlngs = [[pt(0, 0), pt(0, 5)]];
    layers.region00!.fire("pm:edit");
    await Promise.resolve();
    expect(updates).toEqual([]);
    expect(rejected).toEqual(["region00"]);
  });

  it("re-enables Geoman on a shape only when its model geometry changed or after an edit", async () => {
    const { layers, editor } = setup();
    editor.sync(model(FEATURES));
    const enables = () => layers.region00!.callNames.filter((n) => n === "pm.enable").length;
    expect(enables()).toBe(1);
    editor.sync(model(FEATURES));
    expect(enables()).toBe(1);
    editor.sync(model([PIN, LABEL, { ...REGION, polygon: [[0, 0], [0, 9], [-9, 9]] }, PATH]));
    expect(enables()).toBe(2);
    layers.region00!.latlngs = [[pt(0, 0), pt(0, 5), pt(-5, 5), pt(-5, 0)]];
    layers.region00!.fire("pm:edit");
    editor.sync(model(FEATURES));
    expect(enables()).toBe(3);
    await Promise.resolve();
  });

  it("does nothing after destroy", () => {
    const { layers, editor } = setup();
    editor.sync(model(FEATURES));
    editor.destroy();
    expect(layers.region00!.pm.on).toBe(false);
    editor.sync(model(FEATURES));
    editor.setState({ mode: "select", locked: false });
    expect(layers.region00!.pm.on).toBe(false);
  });
});
