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
 *
 * The map model stays the only state: nothing is read back out of Leaflet here.
 * Viewport, zoom limits and the missing-image UX come in bead 4.2.
 */
import * as L from "leaflet";
import { boundsFor, type Bounds } from "../core/frame";
import { installPopoutShim, type ShimLeaflet } from "./popoutShim";
import { SizeGate } from "./sizeGate";

export interface BaseMapOptions {
  /** Resource URL of the map image, or null when the image is missing (no overlay is drawn). */
  imageUrl: string | null;
  /** Image size in pixels, from the map file. */
  width: number;
  height: number;
}

export interface BaseMapHandle {
  readonly map: L.Map;
  readonly bounds: Bounds;
  readonly container: HTMLElement;
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
  const map = L.map(container, {
    crs: L.CRS.Simple,
    attributionControl: false,
    // Fit-to-view needs room below zoom 0 in small panes; bead 4.2 sets the real limits.
    minZoom: -4,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    // The ResizeObserver below replaces Leaflet's global window resize listener.
    trackResize: false,
  });
  if (options.imageUrl) L.imageOverlay(options.imageUrl, bounds, { interactive: false }).addTo(map);

  const gate = new SizeGate({
    getSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    onResize: () => map.invalidateSize({ animate: false }),
    onFirstSize: () => map.fitBounds(bounds, { animate: false }),
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
    refresh: () => {
      if (!destroyed) gate.check(true);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      map.remove();
      container.remove();
    },
  };
};
