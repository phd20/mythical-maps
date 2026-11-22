/**
 * Smooth continuous wheel zoom (design D5 "Smooth zoom", spec map-view
 * "Smooth continuous zoom"). Replaces Leaflet's `scrollWheelZoom`, which
 * debounces wheel events and plays one animated zoom per batch.
 *
 * - Per event: the target zoom moves by `normaliseWheelDelta(event)`, which is
 *   proportional to the wheel delta (pixel, line and page modes behave alike; a
 *   `ctrlKey` wheel, i.e. a trackpad pinch, uses a larger factor).
 * - Clamp and anchor: the target is clamped to the map's current
 *   `[minZoom, maxZoom]` on every event and every frame (so a `minZoom` change
 *   on resize re-clamps it), and zoom stays anchored on the last pointer point.
 * - Easing: one `requestAnimationFrame` loop, taken from the container's own
 *   window (pop-outs), eases the zoom toward the target with
 *   `setZoomAround(point, z, { animate: false })` and stops once it arrives.
 *   Exponential easing never overshoots, so zoom stops cleanly at the limits.
 *
 * The math is pure and exported for unit tests; `attachSmoothWheelZoom` is the
 * DOM/Leaflet-facing part.
 */
import { clampZoom, type ZoomLimits } from "./zoomLimits";

/**
 * Tuning constants. Change these after feel testing.
 * - PIXEL_ZOOM_PER_PX: two-finger trackpad scroll and pixel-mode mouse wheels
 *   (Chrome/Safari report ~100px per mouse notch → ~0.33 zoom).
 * - PINCH_ZOOM_PER_PX: ctrl-wheel (trackpad pinch) deltas are small, so a larger factor.
 * - LINE_PX / PAGE_PX: deltaMode 1 (Firefox mouse wheel, ~3 lines per notch → 120px → 0.4 zoom) and deltaMode 2.
 * - MAX_EVENT_ZOOM: cap per event, so one big mouse notch never jumps more than this.
 * - EASE_TAU_MS: easing time constant; ~63% of the remaining distance is covered per tau.
 * - EPSILON: the loop snaps to the target and stops once this close.
 */
export const PIXEL_ZOOM_PER_PX = 1 / 300;
export const PINCH_ZOOM_PER_PX = 1 / 100;
export const LINE_PX = 40;
export const PAGE_PX = 800;
export const MAX_EVENT_ZOOM = 0.5;
export const EASE_TAU_MS = 100;
export const EPSILON = 1e-3;
/** Frame time used for the first frame and to cap long gaps (a background tab). */
const DEFAULT_FRAME_MS = 16;
const MAX_FRAME_MS = 100;

export interface WheelLike {
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages (`WheelEvent.DOM_DELTA_*`). */
  deltaMode: number;
  ctrlKey: boolean;
}

/** Zoom change for one wheel event: positive zooms in (wheel up / pinch out). */
export function normaliseWheelDelta(e: WheelLike): number {
  const px = e.deltaMode === 1 ? e.deltaY * LINE_PX : e.deltaMode === 2 ? e.deltaY * PAGE_PX : e.deltaY;
  const dz = -px * (e.ctrlKey ? PINCH_ZOOM_PER_PX : PIXEL_ZOOM_PER_PX);
  if (!Number.isFinite(dz)) return 0;
  // `0 + …` avoids returning -0 for a zero delta.
  return 0 + Math.max(-MAX_EVENT_ZOOM, Math.min(MAX_EVENT_ZOOM, dz));
}

/** One easing step from `current` toward `target` after `dtMs`; returns `target` exactly once within EPSILON. */
export function stepToward(current: number, target: number, dtMs: number, tauMs: number = EASE_TAU_MS): number {
  const dt = Math.max(0, dtMs);
  const next = current + (target - current) * (1 - Math.exp(-dt / tauMs));
  return Math.abs(target - next) < EPSILON ? target : next;
}

/** The parts of `L.Map` the handler uses; `P` is Leaflet's `Point`. */
export interface SmoothZoomMap<P> {
  getZoom(): number;
  getMinZoom(): number;
  getMaxZoom(): number;
  mouseEventToContainerPoint(e: MouseEvent): P;
  setZoomAround(point: P, zoom: number, options: { animate: boolean }): unknown;
}

export interface SmoothWheelZoomHandle {
  /** Remove the wheel listener and cancel any running frame. Idempotent. */
  destroy(): void;
}

interface FrameWindow {
  requestAnimationFrame(cb: (t: number) => void): number;
  cancelAnimationFrame(id: number): void;
}

/**
 * Listen for `wheel` on `container` and ease the map's zoom. The map must be
 * created with `scrollWheelZoom: false` so Leaflet's own handler is off.
 */
export function attachSmoothWheelZoom<P>(map: SmoothZoomMap<P>, container: HTMLElement): SmoothWheelZoomHandle {
  const win = container.ownerDocument?.defaultView as FrameWindow | null | undefined;
  const limits = (): ZoomLimits => ({ min: map.getMinZoom(), max: map.getMaxZoom() });

  let target = 0;
  let point: P | null = null;
  let frame: number | null = null;
  let lastTime: number | null = null;
  let destroyed = false;

  const stop = (): void => {
    if (frame !== null) win?.cancelAnimationFrame(frame);
    frame = null;
    lastTime = null;
  };

  const tick = (time: number): void => {
    frame = null;
    if (destroyed || point === null) return;
    const dt = lastTime === null ? DEFAULT_FRAME_MS : Math.min(MAX_FRAME_MS, time - lastTime);
    lastTime = time;
    target = clampZoom(target, limits());
    const current = map.getZoom();
    const next = clampZoom(stepToward(current, target, dt), limits());
    if (next !== current) map.setZoomAround(point, next, { animate: false });
    const reached = map.getZoom();
    // Stop once at the target, or if the map refused to move (e.g. mid-animation).
    if (Math.abs(target - reached) < EPSILON || reached === current) {
      lastTime = null;
      return;
    }
    frame = win ? win.requestAnimationFrame(tick) : null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const dz = normaliseWheelDelta(e);
    if (dz === 0) return;
    // A fresh gesture starts from wherever the map is now (buttons, double-click, resize).
    const base = frame === null ? map.getZoom() : target;
    target = clampZoom(base + dz, limits());
    point = map.mouseEventToContainerPoint(e);
    if (frame === null && win) frame = win.requestAnimationFrame(tick);
  };

  container.addEventListener("wheel", onWheel, { passive: false });

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stop();
      container.removeEventListener("wheel", onWheel);
    },
  };
}
