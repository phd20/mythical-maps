/**
 * Geometry drawing and editing (bead 5.3, spec map-editing "Create features"
 * and "Drag and reshape"; design D5: Leaflet + Geoman free).
 *
 * - Drawing: in Region or Path mode (and unlocked) Geoman's Polygon or Line draw
 *   mode is on. When a shape is finished the editor reads its vertices, removes
 *   Geoman's own layer and reports `createShape(kind, vertices)`; the view
 *   creates the feature through the document model, and the renderer draws it.
 *   Too few vertices are the view's call (`createShapeOp` returns null).
 * - Editing: in Select mode (and unlocked) pins and labels are draggable
 *   (Leaflet's own marker dragging) and regions and paths get Geoman's vertex
 *   editing (move, add via the mid-point handles, remove by right-click). After
 *   each gesture the final geometry is reported with `updateFeature(id, patch)`.
 *   While locked, or in another mode, nothing is draggable or editable.
 *
 * The model is the only state: layers are never read beyond the final geometry
 * of a gesture, and `sync(model)` (called after every render) re-applies the
 * editing state, re-enabling Geoman on a shape whose model geometry changed
 * (Geoman keeps its own vertex handles, which `setLatLngs` leaves stale).
 *
 * Pop-out windows: dragging (markers and Geoman's vertex handles) uses Leaflet's
 * `Draggable`, which the pop-out shim (`popoutShim.ts`) already routes to the
 * map's own window. Geoman's optional keyboard shortcuts (Esc, Enter) listen on
 * the main window's document only; finish a shape by clicking its first or last
 * vertex, and switch mode to cancel.
 */
import type * as L from "leaflet";
import "./geoman";
import { geometryPatch, type DrawableKind, type LatLngLike } from "../core/create";
import type { FeaturePatch } from "../core/features";
import type { Feature, LatLng, MapDocument } from "../core/schema";
import type { EditMode } from "./toolbar";

export interface GeometryHandlers {
  /** A region or path was drawn; `vertices` are as drawn (the view validates the count). */
  createShape(kind: DrawableKind, vertices: LatLngLike[]): void;
  /** A pin, label, region or path was moved or reshaped; apply `patch` to feature `id`. */
  updateFeature(id: string, patch: FeaturePatch): void;
  /** A reshape ended with invalid geometry (too few vertices): the view re-renders the model. */
  rejected?(id: string): void;
}

export interface EditState {
  mode: EditMode;
  locked: boolean;
}

export interface GeometryEditor {
  /** Change the mode or lock: turns drawing on or off, and editing of existing features. */
  setState(state: EditState): void;
  /** Re-apply editing to the layers of `model`'s features; call after every render. */
  sync(model: MapDocument): void;
  destroy(): void;
}

const DRAW_SHAPES: Partial<Record<EditMode, { shape: "Polygon" | "Line"; kind: DrawableKind }>> = {
  region: { shape: "Polygon", kind: "region" },
  path: { shape: "Line", kind: "path" },
};

/** Look of the shape being drawn; the committed feature is drawn by the renderer. */
const DRAW_STYLE: L.PathOptions = { color: "#3388ff", weight: 2, fillOpacity: 0.1 };

const EDIT_OPTIONS = {
  snappable: false,
  allowSelfIntersection: true,
  removeLayerBelowMinVertexCount: false,
  // Vertices are removed with a right-click; the mid-point handles add vertices.
  removeVertexOn: "contextmenu",
} as const;

type Shape = L.Polygon | L.Polyline;

/** What `geometryPatch` needs from a feature: its type and which field holds the shape. */
const geometrySignature = (f: Feature): string =>
  f.type === "region" ? JSON.stringify([f.polygon, f.polygons]) : f.type === "path" ? JSON.stringify(f.polyline) : "";

export function createGeometryEditor(
  map: L.Map,
  layerFor: (id: string) => L.Layer | undefined,
  handlers: GeometryHandlers,
): GeometryEditor {
  let state: EditState = { mode: "select", locked: false };
  let drawKind: DrawableKind | null = null;
  let features = new Map<string, Feature>();
  /** Layers that already carry our listeners. */
  const wired = new WeakSet<L.Layer>();
  /** For shapes with Geoman editing on: the geometry signature it was enabled for (null forces a re-enable). */
  const enabledFor = new Map<string, string | null>();
  let destroyed = false;

  const editing = (): boolean => state.mode === "select" && !state.locked;

  const onCreate = (event: L.LeafletEvent): void => {
    const layer = (event as unknown as { layer: L.Polyline | L.Polygon }).layer;
    const kind = drawKind;
    if (!kind) return;
    const raw = layer.getLatLngs() as unknown;
    const vertices = (kind === "region" ? (raw as LatLngLike[][])[0] : (raw as LatLngLike[])) ?? [];
    // The model is the only state: drop Geoman's layer; the renderer draws the created feature.
    layer.remove();
    handlers.createShape(kind, vertices);
  };
  map.on("pm:create", onCreate);

  function applyDrawing(): void {
    const want = state.locked ? undefined : DRAW_SHAPES[state.mode];
    if (!want) {
      if (drawKind) map.pm.disableDraw();
      drawKind = null;
      return;
    }
    if (drawKind === want.kind) return;
    if (drawKind) map.pm.disableDraw();
    drawKind = want.kind;
    map.pm.enableDraw(want.shape, {
      snappable: false,
      allowSelfIntersection: true,
      continueDrawing: true,
      tooltips: false,
      pathOptions: DRAW_STYLE,
      templineStyle: DRAW_STYLE,
      hintlineStyle: { ...DRAW_STYLE, dashArray: "5,5" },
    });
  }

  function wireMarker(id: string, marker: L.Marker): void {
    if (wired.has(marker)) return;
    wired.add(marker);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      handlers.updateFeature(id, { pos: [p.lat, p.lng] satisfies LatLng });
    });
  }

  function wireShape(id: string, shape: Shape): void {
    if (wired.has(shape)) return;
    wired.add(shape);
    shape.on("pm:edit", () => {
      const feature = features.get(id);
      const patch = feature ? geometryPatch(feature, shape.getLatLngs()) : null;
      // Whatever happens next, the layer no longer matches what Geoman was enabled for.
      enabledFor.set(id, null);
      // Saving re-renders, which re-enables Geoman on this shape: wait until Geoman's own handler has finished.
      queueMicrotask(() => {
        if (destroyed) return;
        if (!patch) handlers.rejected?.(id);
        else handlers.updateFeature(id, patch);
      });
    });
  }

  function setMarkerDraggable(marker: L.Marker, on: boolean): void {
    const dragging = marker.dragging;
    if (!dragging) return;
    if (on) dragging.enable();
    else dragging.disable();
  }

  function setShapeEditable(id: string, shape: Shape, on: boolean, signature: string): void {
    const enabled = shape.pm.enabled();
    if (!on) {
      if (enabled) shape.pm.disable();
      enabledFor.delete(id);
      return;
    }
    if (enabled && enabledFor.get(id) === signature) return;
    if (enabled) shape.pm.disable();
    shape.pm.enable(EDIT_OPTIONS);
    enabledFor.set(id, signature);
  }

  return {
    setState(next) {
      if (destroyed) return;
      state = next;
      applyDrawing();
      // Editing follows the new state at the next `sync`; apply to known layers now too.
      for (const [id, f] of features) applyToLayer(id, f);
    },
    sync(model) {
      if (destroyed) return;
      features = new Map(model.features.map((f) => [f.id, f]));
      for (const id of [...enabledFor.keys()]) if (!features.has(id)) enabledFor.delete(id);
      for (const [id, f] of features) applyToLayer(id, f);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      map.off("pm:create", onCreate);
      if (drawKind) map.pm.disableDraw();
      drawKind = null;
      for (const id of [...enabledFor.keys()]) {
        const layer = layerFor(id);
        if (layer && (layer as Shape).pm.enabled()) (layer as Shape).pm.disable();
      }
      enabledFor.clear();
      features.clear();
    },
  };

  function applyToLayer(id: string, f: Feature): void {
    const layer = layerFor(id);
    if (!layer) {
      enabledFor.delete(id);
      return;
    }
    if (f.type === "pin" || f.type === "label") {
      const marker = layer as L.Marker;
      wireMarker(id, marker);
      setMarkerDraggable(marker, editing());
    } else if (f.type === "region" || f.type === "path") {
      const shape = layer as Shape;
      wireShape(id, shape);
      setShapeEditable(id, shape, editing(), geometrySignature(f));
    }
  }
}
