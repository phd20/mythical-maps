/**
 * Recording stub of the parts of Leaflet that `src/ui/baseMap.ts` uses.
 * vitest aliases `leaflet` to this file (see vitest.config.ts), because the
 * real library touches `window` at import time and tests run in node.
 * Every created map and overlay is pushed onto `created` for assertions.
 */

export const CRS = { Simple: { name: "Simple" } };

export interface MapCall {
  name: string;
  args: unknown[];
}

export class MockMap {
  calls: MapCall[] = [];
  layers: MockImageOverlay[] = [];
  removed = false;
  constructor(
    public container: unknown,
    public options: Record<string, unknown>,
  ) {}
  invalidateSize(...args: unknown[]): this {
    this.calls.push({ name: "invalidateSize", args });
    return this;
  }
  fitBounds(...args: unknown[]): this {
    this.calls.push({ name: "fitBounds", args });
    return this;
  }
  remove(): this {
    this.removed = true;
    return this;
  }
  /** Names of the calls made so far, in order. */
  get callNames(): string[] {
    return this.calls.map((c) => c.name);
  }
  // 4.2 viewport & zoom limits. `center`/`zoom` track setView only (fitBounds leaves them unchanged).
  center: [number, number] = [0, 0];
  zoom = 0;
  /** Like Leaflet, a non-animated zoom change (`_resetView`) fires `zoom` then `zoomend` synchronously. */
  setView(center: [number, number] | { lat: number; lng: number }, zoom: number, ...rest: unknown[]): this {
    this.calls.push({ name: "setView", args: [center, zoom, ...rest] });
    const reset = (rest[0] as { animate?: boolean } | undefined)?.animate === false && zoom !== this.zoom;
    this.center = Array.isArray(center) ? center : [center.lat, center.lng];
    this.zoom = zoom;
    if (reset) {
      this.fire("zoom");
      this.fire("zoomend");
    }
    return this;
  }
  setMinZoom(zoom: number): this {
    this.calls.push({ name: "setMinZoom", args: [zoom] });
    this.options.minZoom = zoom;
    return this;
  }
  getCenter(): { lat: number; lng: number } {
    return { lat: this.center[0], lng: this.center[1] };
  }
  getZoom(): number {
    return this.zoom;
  }
  // 4.4 visibility: event listeners, fired by tests with `fire`.
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  on(type: string, fn: (e?: unknown) => void): this {
    for (const t of type.split(/\s+/)) (this.listeners[t] ??= []).push(fn);
    return this;
  }
  off(type: string, fn: (e?: unknown) => void): this {
    for (const t of type.split(/\s+/)) this.listeners[t] = (this.listeners[t] ?? []).filter((f) => f !== fn);
    return this;
  }
  fire(type: string, e?: unknown): this {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(e);
    return this;
  }
  // Geoman (bead 5.3): records draw-mode calls.
  drawing: { shape: string; options: Record<string, unknown> } | null = null;
  pm = {
    enableDraw: (shape: string, options: Record<string, unknown> = {}): void => {
      this.calls.push({ name: "pm.enableDraw", args: [shape, options] });
      this.drawing = { shape, options };
    },
    disableDraw: (): void => {
      this.calls.push({ name: "pm.disableDraw", args: [] });
      this.drawing = null;
    },
  };
  // Smooth wheel zoom surface (bead 4.6), used by the 4.4 mid-zoom test.
  getMinZoom(): number {
    return (this.options.minZoom as number | undefined) ?? 0;
  }
  getMaxZoom(): number {
    return (this.options.maxZoom as number | undefined) ?? 0;
  }
  mouseEventToContainerPoint(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  getSize(): { x: number; y: number } {
    return { x: 0, y: 0 };
  }
  /** `CRS.Simple`: one map unit is 2^zoom pixels, latitude pointing up. */
  project(c: { lat: number; lng: number }, zoom: number): { x: number; y: number } {
    return { x: c.lng * 2 ** zoom, y: -c.lat * 2 ** zoom };
  }
  unproject([x, y]: [number, number], zoom: number): { lat: number; lng: number } {
    return { lat: -y / 2 ** zoom, lng: x / 2 ** zoom };
  }
}

export class MockImageOverlay {
  map: MockMap | null = null;
  _url: unknown;
  _image: unknown = null;
  _zoomAnimated = true;
  declare _initImage?: () => void;
  constructor(
    public url: string,
    public bounds: unknown,
    public options: Record<string, unknown>,
  ) {
    this._url = url;
  }
  addTo(map: MockMap): this {
    this.map = map;
    map.layers.push(this);
    // Like Leaflet's `onAdd`: the element is set up the first time the layer is added.
    if (!this._image) this._initImage?.();
    return this;
  }
  remove(): this {
    if (this.map) this.map.layers = this.map.layers.filter((l) => l !== this);
    this.map = null;
    return this;
  }
}

/** `L.ImageOverlay`, as far as subclassing it with `extend` goes. */
export const ImageOverlay = {
  extend(props: Record<string, unknown>): typeof MockImageOverlay {
    class Extended extends MockImageOverlay {}
    Object.assign(Extended.prototype, props);
    return Extended;
  },
};

export const created: { maps: MockMap[]; overlays: MockImageOverlay[] } = { maps: [], overlays: [] };

export function map(container: unknown, options: Record<string, unknown> = {}): MockMap {
  const m = new MockMap(container, options);
  created.maps.push(m);
  return m;
}

export function imageOverlay(url: string, bounds: unknown, options: Record<string, unknown> = {}): MockImageOverlay {
  const o = new MockImageOverlay(url, bounds, options);
  created.overlays.push(o);
  return o;
}

/** Prototypes the pop-out shim patches; empty methods are enough for installation. */
export class Draggable {
  _onDown(): void {}
  _onMove(): void {}
  finishDrag(): void {}
}

export const Map = {
  BoxZoom: class {
    _onMouseDown(): void {}
    _finish(): void {}
  },
  Keyboard: class {
    _addHooks(): void {}
    _removeHooks(): void {}
  },
  TouchZoom: class {
    _onTouchStart(): void {}
    _onTouchEnd(): void {}
  },
};

// --- Feature layers (bead 4.3 feature renderer) ---

export interface MockTooltip {
  content: unknown;
  options: Record<string, unknown>;
}

/** Recording stand-in for markers, polygons and polylines. */
export class MockFeatureLayer {
  map: unknown = null;
  removed = false;
  tooltip: MockTooltip | null = null;
  calls: MapCall[] = [];
  constructor(
    public kind: "marker" | "polygon" | "polyline",
    public latlngs: unknown,
    public options: Record<string, unknown>,
  ) {}
  private record(name: string, args: unknown[]): void {
    this.calls.push({ name, args });
  }
  addTo(map: unknown): this {
    this.map = map;
    this.removed = false;
    return this;
  }
  remove(): this {
    this.map = null;
    this.removed = true;
    return this;
  }
  setLatLng(latlng: unknown): this {
    this.record("setLatLng", [latlng]);
    this.latlngs = latlng;
    return this;
  }
  setLatLngs(latlngs: unknown): this {
    this.record("setLatLngs", [latlngs]);
    this.latlngs = latlngs;
    return this;
  }
  setIcon(icon: unknown): this {
    this.record("setIcon", [icon]);
    this.options = { ...this.options, icon };
    return this;
  }
  setStyle(style: Record<string, unknown>): this {
    this.record("setStyle", [style]);
    this.options = { ...this.options, ...style };
    return this;
  }
  bindTooltip(content: unknown, options: Record<string, unknown> = {}): this {
    this.record("bindTooltip", [content, options]);
    this.tooltip = { content, options };
    return this;
  }
  unbindTooltip(): this {
    this.record("unbindTooltip", []);
    this.tooltip = null;
    return this;
  }
  get callNames(): string[] {
    return this.calls.map((c) => c.name);
  }
  // Bead 6.2: layer events (hover and click hooks).
  handlers: Record<string, Array<(e: unknown) => void>> = {};
  /** What `getElement()` returns; tests set it. */
  element: unknown = undefined;
  on(type: string, fn: (e: unknown) => void): this {
    (this.handlers[type] ??= []).push(fn);
    return this;
  }
  getElement(): unknown {
    return this.element;
  }
  // Bead 5.3: marker dragging (Leaflet handler) and Geoman vertex editing (`pm`).
  dragging = {
    enabled: false,
    enable: (): void => {
      this.dragging.enabled = true;
    },
    disable: (): void => {
      this.dragging.enabled = false;
    },
  };
  pm = {
    on: false,
    enabled: (): boolean => this.pm.on,
    enable: (options?: unknown): void => {
      this.pm.on = true;
      this.record("pm.enable", [options]);
    },
    disable: (): void => {
      this.pm.on = false;
      this.record("pm.disable", []);
    },
  };
  getLatLng(): unknown {
    return this.latlngs;
  }
  getLatLngs(): unknown {
    return this.latlngs;
  }
  /** Fire a Leaflet event on this layer, e.g. `fire("click", { originalEvent })`. */
  fire(type: string, e: unknown = {}): this {
    for (const fn of [...(this.handlers[type] ?? [])]) fn(e);
    return this;
  }
}

export class MockDivIcon {
  constructor(public options: Record<string, unknown>) {}
}

export const featureLayers: MockFeatureLayer[] = [];

export function marker(latlng: unknown, options: Record<string, unknown> = {}): MockFeatureLayer {
  const l = new MockFeatureLayer("marker", latlng, options);
  featureLayers.push(l);
  return l;
}

export function polygon(latlngs: unknown, options: Record<string, unknown> = {}): MockFeatureLayer {
  const l = new MockFeatureLayer("polygon", latlngs, options);
  featureLayers.push(l);
  return l;
}

export function polyline(latlngs: unknown, options: Record<string, unknown> = {}): MockFeatureLayer {
  const l = new MockFeatureLayer("polyline", latlngs, options);
  featureLayers.push(l);
  return l;
}

export function divIcon(options: Record<string, unknown> = {}): MockDivIcon {
  return new MockDivIcon(options);
}
