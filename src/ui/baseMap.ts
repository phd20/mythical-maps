/**
 * Leaflet base map: the image (`imageLayer.ts`) on the frame bounds in
 * `CRS.Simple` (design D3, D5), kept correctly sized (D6).
 *
 * - The Leaflet container is created through the parent's DOM helpers, so it
 *   belongs to the view's own document (pop-out windows).
 * - A `ResizeObserver` from the container's own window, plus `refresh()` (called
 *   from `View.onResize()`), runs `invalidateSize`.
 * - The initial fit waits until the container has a non-zero size, so a map
 *   opened in a background tab fits correctly once it is shown.
 * - `installPopoutShim` routes Leaflet's global drag listeners to the right window.
 * - Zoom limits (bead 4.2, `zoomLimits.ts`): `maxZoom` is `z + 2`; `minZoom` is
 *   the zoom that fits the whole image, set once the container has a size and
 *   recomputed on every resize.
 * - Wheel and pinch zoom are continuous (bead 4.6, `smoothWheelZoom.ts`).
 * - The first view is the saved `viewport` (zoom clamped to the limits), or a
 *   fit of the whole image when there is none.
 *
 * - Features (bead 4.3, `featureRenderer.ts`) are drawn by `render(model, view?)`,
 *   also when the image is missing; glyphs come from the injected `icons`.
 * - Visibility (bead 4.4, `visibility.ts`): hidden folders and zoom ranges. The
 *   last model is kept and re-evaluated on `zoom`, `zoomend` and limit changes;
 *   features are re-rendered only when the visible set changes.
 *
 * The map model stays the only state: nothing is read back out of Leaflet into
 * the model. `currentViewport()` reads the live centre and zoom only so the
 * view can save them as `viewport` through the document model.
 */
import * as L from "leaflet";
import { boundsFor, type Bounds } from "../core/frame";
import type { LatLng, MapDocument, Viewport } from "../core/schema";
import { createGeometryEditor, type EditState, type GeometryEditor, type GeometryHandlers } from "./geometryEditor";
import { addImageLayer, type ImageSource } from "./imageLayer";
import { createFeatureRenderer, type FeatureInteractions, type IconProvider, type RenderView } from "./featureRenderer";
import { installPopoutShim, type ShimLeaflet } from "./popoutShim";
import { SizeGate } from "./sizeGate";
import { attachSmoothWheelZoom } from "./smoothWheelZoom";
import { createVisibilityRenderer } from "./visibility";
import { clampZoom, maxZoomFor, viewportFrom, ZOOM_DELTA, ZOOM_SNAP, zoomLimits, type ZoomLimits } from "./zoomLimits";

/** Pointer hooks on the empty map or any non-marker layer (bead 5.2); positions are `[lat, lng]`. */
export interface MapPointerHandlers {
  onClick?(pos: LatLng, event: MouseEvent): void;
  onContextMenu?(pos: LatLng, event: MouseEvent): void;
}

export interface BaseMapOptions {
  /** Resource URL of the map image, or null when the image is missing (no overlay is drawn). */
  imageUrl: string | null;
  /** The image file's bytes, so a large image can be cached (see `imageLayer.ts`). */
  imageSource?: ImageSource;
  /** Image size in pixels, from the map file. */
  width: number;
  height: number;
  /** Saved opening view; when absent the whole image is fitted. */
  viewport?: Viewport;
  /** Pin glyphs (Obsidian's `setIcon` in the plugin). Without it every glyph falls back to a dot. */
  icons?: IconProvider;
  /** Hover and click hooks on features (bead 6.2, see `featureRenderer.ts`). */
  interactions?: FeatureInteractions;
  /** Click and context-menu hooks on the map itself (bead 5.2: creating features). */
  pointer?: MapPointerHandlers;
  /** Save hooks for drawing and editing geometry (bead 5.3, see `geometryEditor.ts`). Without them nothing is drawable or draggable. */
  geometry?: GeometryHandlers;
}

/** Fallback icon provider: knows no icons, so pins draw the dot glyph. */
export const NO_ICONS: IconProvider = { has: () => false, set: () => {} };

export interface BaseMapHandle {
  readonly map: L.Map;
  readonly bounds: Bounds;
  readonly container: HTMLElement;
  /** Current zoom limits, or null until the container first has a size. */
  readonly limits: ZoomLimits | null;
  /** The live centre and zoom, rounded for saving; null until the first view is set. */
  currentViewport(): Viewport | null;
  /** Set the toolbar mode and lock state that decide what can be drawn, dragged and reshaped (bead 5.3). */
  setEditState(state: EditState): void;
  /** Draw the model's features, reusing layers by id (see `featureRenderer.ts`). No-op after destroy. */
  render(model: MapDocument, view?: RenderView): void;
  /** Pan to `pos`, keeping the zoom (clamped to the limits). Before the first size is known, applied once it is. No-op after destroy. */
  centerOn(pos: LatLng): void;
  /** Fit the whole image in view (animated). No-op after destroy. */
  fit(): void;
  /** Re-check the container size: `invalidateSize`, plus the deferred initial fit. */
  refresh(): void;
  /** Tear down the Leaflet map, the resize observer and the container. Idempotent. */
  destroy(): void;
}

export type MountBaseMap = (parent: HTMLElement, options: BaseMapOptions) => BaseMapHandle;

/** The container's own window's ResizeObserver (pop-out safe), if there is one. */
function resizeObserverFor(el: HTMLElement): typeof ResizeObserver | undefined {
  const win = el.ownerDocument?.defaultView as (Window & typeof globalThis) | null | undefined;
  return win?.ResizeObserver ?? (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
}

export const mountBaseMap: MountBaseMap = (parent, options) => {
  installPopoutShim(L as unknown as ShimLeaflet);

  const container = parent.createDiv({ cls: "mythical-map-leaflet" });
  const bounds = boundsFor(options.width, options.height);
  const { width, height, viewport } = options;
  const map = L.map(container, {
    crs: L.CRS.Simple,
    attributionControl: false,
    // minZoom (fit) needs the container size; it is set before the first view.
    maxZoom: maxZoomFor(width, height),
    zoomSnap: ZOOM_SNAP,
    zoomDelta: ZOOM_DELTA,
    // Replaced by the smooth wheel handler below (bead 4.6, `smoothWheelZoom.ts`).
    scrollWheelZoom: false,
    // The ResizeObserver below replaces Leaflet's global window resize listener.
    trackResize: false,
  });
  const wheelZoom = attachSmoothWheelZoom(map, container);
  const image = options.imageUrl
    ? addImageLayer(map, container, {
        imageUrl: options.imageUrl,
        bounds,
        width,
        height,
        ...(options.imageSource ? { source: options.imageSource } : {}),
      })
    : null;

  const renderer = createFeatureRenderer(map, {
    icons: options.icons ?? NO_ICONS,
    ownerDocument: container.ownerDocument,
    ...(options.interactions ? { interactions: options.interactions } : {}),
  });

  const pointer = options.pointer;
  const onMapClick = (e: L.LeafletMouseEvent): void => pointer?.onClick?.([e.latlng.lat, e.latlng.lng], e.originalEvent);
  const onMapContextMenu = (e: L.LeafletMouseEvent): void =>
    pointer?.onContextMenu?.([e.latlng.lat, e.latlng.lng], e.originalEvent);
  if (pointer) {
    map.on("click", onMapClick);
    map.on("contextmenu", onMapContextMenu);
  }

  let limits: ZoomLimits | null = null;
  const visibility = createVisibilityRenderer(renderer, () => ({ zoom: map.getZoom(), limits }));
  // Geometry editing (bead 5.3): re-applied after every render, since layers come and go.
  const geometry: GeometryEditor | null = options.geometry
    ? createGeometryEditor(map, (id) => renderer.layerFor(id), options.geometry)
    : null;
  let lastModel: MapDocument | null = null;
  const syncGeometry = (): void => {
    if (lastModel) geometry?.sync(lastModel);
  };
  const onZoom = (): void => {
    visibility.update();
    syncGeometry();
  };
  map.on("zoom", onZoom);
  map.on("zoomend", onZoom);
  let viewSet = false;
  let pendingCenter: LatLng | null = null;
  const gate = new SizeGate({
    getSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    onResize: () => {
      map.invalidateSize({ animate: false });
      limits = zoomLimits(width, height, container.clientWidth, container.clientHeight);
      // Leaflet zooms in to the new minimum itself if the current zoom is now below it.
      map.setMinZoom(limits.min);
      visibility.update();
      syncGeometry();
    },
    onFirstSize: () => {
      if (viewport && limits) map.setView(viewport.center, clampZoom(viewport.zoom, limits), { animate: false });
      else map.fitBounds(bounds, { animate: false });
      if (pendingCenter) map.setView(pendingCenter, map.getZoom(), { animate: false });
      pendingCenter = null;
      viewSet = true;
      visibility.update();
      syncGeometry();
    },
  });

  const RO = resizeObserverFor(container);
  const observer = RO ? new RO(() => gate.check()) : null;
  observer?.observe(container);
  gate.check();

  let destroyed = false;
  return {
    map,
    bounds,
    container,
    get limits() {
      return limits;
    },
    currentViewport: () => {
      if (!viewSet || destroyed) return null;
      const c = map.getCenter();
      return viewportFrom([c.lat, c.lng], map.getZoom());
    },
    setEditState: (state) => geometry?.setState(state),
    render: (model, view) => {
      if (destroyed) return;
      visibility.render(model, view);
      lastModel = model;
      syncGeometry();
    },
    centerOn: (pos) => {
      if (destroyed) return;
      if (viewSet && limits) map.setView(pos, clampZoom(map.getZoom(), limits), { animate: false });
      else pendingCenter = pos;
    },
    fit: () => {
      if (!destroyed) map.fitBounds(bounds);
    },
    refresh: () => {
      if (!destroyed) gate.check(true);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      map.off("zoom", onZoom);
      map.off("zoomend", onZoom);
      map.off("click", onMapClick);
      map.off("contextmenu", onMapContextMenu);
      geometry?.destroy();
      renderer.destroy();
      wheelZoom.destroy();
      image?.destroy();
      map.remove();
      container.remove();
    },
  };
};
