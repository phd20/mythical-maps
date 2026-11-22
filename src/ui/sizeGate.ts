/**
 * Sizing logic for the map container (design D6, spec map-view "Correct sizing").
 *
 * A map opened in a background tab has a 0×0 container, and fitting the image
 * then produces a wrong zoom. `SizeGate` defers the initial fit until the
 * container first has a non-zero size, and calls `onResize` (which should call
 * `invalidateSize`) on every later size check. It has no DOM or Leaflet
 * dependency; the caller feeds it size checks from a `ResizeObserver`,
 * `View.onResize()` and so on.
 */

export interface Size {
  width: number;
  height: number;
}

export interface SizeGateHooks {
  /** Current container size. */
  getSize: () => Size;
  /** Called on every check while the container has a non-zero size, before `onFirstSize`. */
  onResize: () => void;
  /** Called once, on the first check that sees a non-zero size. */
  onFirstSize: () => void;
}

export class SizeGate {
  private ready = false;
  private last: Size | null = null;

  constructor(private readonly hooks: SizeGateHooks) {}

  /** True once the initial fit has run. */
  get hasSize(): boolean {
    return this.ready;
  }

  /**
   * Check the container size. A zero (hidden) size is ignored. A non-zero size
   * that differs from the last one seen calls `onResize`, plus `onFirstSize`
   * the first time. Pass `force` to call `onResize` even if the size is unchanged.
   */
  check(force = false): void {
    const size = this.hooks.getSize();
    if (!(size.width > 0 && size.height > 0)) return;
    const changed = !this.last || this.last.width !== size.width || this.last.height !== size.height;
    this.last = { width: size.width, height: size.height };
    if (!changed && !force && this.ready) return;
    this.hooks.onResize();
    if (!this.ready) {
      this.ready = true;
      this.hooks.onFirstSize();
    }
  }
}
