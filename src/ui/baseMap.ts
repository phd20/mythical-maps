/**
 * Leaflet base map: the image as an `imageOverlay` on the frame bounds in
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
import type { MapDocument, Viewport } from "../core/schema";
import { createFeatureRenderer, type FeatureInteractions, type IconProvider, type RenderView } from "./featureRenderer";
import { installPopoutShim, type ShimLeaflet } from "./popoutShim";
import { SizeGate } from "./sizeGate";
import { attachSmoothWheelZoom } from "./smoothWheelZoom";
import { createVisibilityRenderer } from "./visibility";
import { clampZoom, maxZoomFor, viewportFrom, ZOOM_DELTA, ZOOM_SNAP, zoomLimits, type ZoomLimits } from "./zoomLimits";

export interface BaseMapOptions {
  /** Resource URL of the map image, or null when the image is missing (no overlay is drawn). */
  imageUrl: string | null;
  /** Image size in pixels, from the map file. */
  width: number;
  height: number;
  /** Saved opening view; when absent the whole image is fitted. */
  viewport?: Viewport;
  /** Pin glyphs (Obsidian's `setIcon` in the plugin). Without it every glyph falls back to a dot. */
  icons?: IconProvider;
  /** Hover and click hooks on features (bead 6.2, see `featureRenderer.ts`). */
  interactions?: FeatureInteractions;
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
  /** Draw the model's features, reusing layers by id (see `featureRenderer.ts`). No-op after destroy. */
  render(model: MapDocument, view?: RenderView): void;
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
  if (options.imageUrl) L.imageOverlay(options.imageUrl, bounds, { interactive: false }).addTo(map);

  const renderer = createFeatureRenderer(map, {
    icons: options.icons ?? NO_ICONS,
    ownerDocument: container.ownerDocument,
    ...(options.interactions ? { interactions: options.interactions } : {}),
  });

  let limits: ZoomLimits | null = null;
  const visibility = createVisibilityRenderer(renderer, () => ({ zoom: map.getZoom(), limits }));
  const onZoom = (): void => visibility.update();
  map.on("zoom", onZoom);
  map.on("zoomend", onZoom);
  let viewSet = false;
  const gate = new SizeGate({
    getSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    onResize: () => {
      map.invalidateSize({ animate: false });
      limits = zoomLimits(width, height, container.clientWidth, container.clientHeight);
      // Leaflet zooms in to the new minimum itself if the current zoom is now below it.
      map.setMinZoom(limits.min);
      visibility.update();
    },
    onFirstSize: () => {
      if (viewport && limits) map.setView(viewport.center, clampZoom(viewport.zoom, limits), { animate: false });
      else map.fitBounds(bounds, { animate: false });
      viewSet = true;
      visibility.update();
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
    render: (model, view) => {
      if (!destroyed) visibility.render(model, view);
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
      renderer.destroy();
      wheelZoom.destroy();
      map.remove();
      container.remove();
    },
  };
};
