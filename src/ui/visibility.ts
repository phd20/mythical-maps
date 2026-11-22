/**
 * Visibility (bead 4.4, design D3, spec map-view "Visibility rules").
 *
 * Wraps the feature renderer so only visible features are drawn: a feature is
 * visible when it is not effectively hidden (its own or an ancestor folder's
 * `isHidden`) and the current zoom lies inside its `visibilityRange`, mapped
 * linearly onto the map's current `[minZoom, maxZoom]`.
 *
 * `render(model, view)` remembers the model; `update()` is called on every
 * `zoom` / `zoomend` and whenever the limits change. It recomputes the visible
 * set and re-renders only when that set changed, so it is cheap to call during
 * a continuous zoom. Until the limits are known, zoom ranges are not applied.
 */
import { hiddenIds, visibleAtZoom } from "../core/features";
import type { Feature, MapDocument } from "../core/schema";
import type { FeatureRenderer, RenderView } from "./featureRenderer";
import type { ZoomLimits } from "./zoomLimits";

export interface ZoomState {
  zoom: number;
  limits: ZoomLimits | null;
}

export interface VisibilityRenderer {
  /** Draw `model` with only its visible features; `view.isVisible`, if given, is applied on top. */
  render(model: MapDocument, view?: RenderView): void;
  /** Re-evaluate visibility for the current zoom and limits; re-renders only if the visible set changed. */
  update(): void;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function createVisibilityRenderer(renderer: Pick<FeatureRenderer, "render">, zoomState: () => ZoomState): VisibilityRenderer {
  let model: MapDocument | null = null;
  let view: RenderView | undefined;
  let hidden: Set<string> = new Set();
  let drawn: Set<string> = new Set();

  function visibleSet(m: MapDocument): Set<string> {
    const { zoom, limits } = zoomState();
    const extra = view?.isVisible;
    const out = new Set<string>();
    for (const f of m.features) {
      if (f.type === "folder" || hidden.has(f.id)) continue;
      if (limits && !visibleAtZoom(f, zoom, limits.min, limits.max)) continue;
      if (extra && !extra(f)) continue;
      out.add(f.id);
    }
    return out;
  }

  function draw(m: MapDocument, visible: Set<string>): void {
    drawn = visible;
    renderer.render(m, { ...view, isVisible: (f: Feature) => visible.has(f.id) });
  }

  return {
    render(m, v) {
      model = m;
      view = v;
      hidden = hiddenIds(m);
      draw(m, visibleSet(m));
    },
    update() {
      if (!model) return;
      const visible = visibleSet(model);
      if (!sameSet(visible, drawn)) draw(model, visible);
    },
  };
}
