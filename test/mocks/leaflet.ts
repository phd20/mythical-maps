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
  setView(center: [number, number], zoom: number, ...rest: unknown[]): this {
    this.calls.push({ name: "setView", args: [center, zoom, ...rest] });
    this.center = center;
    this.zoom = zoom;
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
}

export class MockImageOverlay {
  map: MockMap | null = null;
  constructor(
    public url: string,
    public bounds: unknown,
    public options: Record<string, unknown>,
  ) {}
  addTo(map: MockMap): this {
    this.map = map;
    map.layers.push(this);
    return this;
  }
}

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
