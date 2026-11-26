import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { created, CRS, Draggable, featureLayers, type MockDivIcon, type MockFeatureLayer, type MockMap } from "./mocks/leaflet";
import { mountBaseMap } from "../src/ui/baseMap";
import { boundsFor } from "../src/core/frame";
import { parseMap } from "../src/core/parse";
import type { Feature, MapDocument } from "../src/core/schema";
import { fitZoom, ZOOM_DELTA, ZOOM_SNAP } from "../src/ui/zoomLimits";

/** A ResizeObserver stand-in owned by a fake window, so the test can fire it. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: unknown[] = [];
  disconnected = false;
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: unknown): void {
    this.observed.push(el);
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

interface FakeEl {
  cls: string | undefined;
  clientWidth: number;
  clientHeight: number;
  removed: boolean;
  ownerDocument: { defaultView: { ResizeObserver: typeof FakeResizeObserver } };
  remove(): void;
  /** Event listeners currently attached, as [type, options]. */
  listeners: [string, unknown][];
  /** The last handler attached per event type. */
  handlers: Record<string, (e: unknown) => void>;
  addEventListener(type: string, fn: unknown, options?: unknown): void;
  removeEventListener(type: string, fn: unknown): void;
}

function fakeParent(width: number, height: number) {
  const ownerDocument = { defaultView: { ResizeObserver: FakeResizeObserver } };
  const children: FakeEl[] = [];
  const parent = {
    ownerDocument,
    createDiv(o?: { cls?: string }): FakeEl {
      const el: FakeEl = {
        cls: o?.cls,
        clientWidth: width,
        clientHeight: height,
        removed: false,
        ownerDocument,
        remove() {
          this.removed = true;
        },
        listeners: [],
        handlers: {},
        addEventListener(type, fn, options) {
          this.listeners.push([type, options]);
          this.handlers[type] = fn as (e: unknown) => void;
        },
        removeEventListener(type) {
          this.listeners = this.listeners.filter(([t]) => t !== type);
        },
      };
      children.push(el);
      return el;
    },
  };
  return { parent: parent as unknown as HTMLElement, children };
}

const lastMap = (): MockMap => {
  const m = created.maps.at(-1);
  if (!m) throw new Error("no map created");
  return m;
};

beforeEach(() => {
  created.maps.length = 0;
  created.overlays.length = 0;
  FakeResizeObserver.instances.length = 0;
});

describe("mountBaseMap", () => {
  it("creates a CRS.Simple map with the image overlay on the frame bounds", () => {
    const { parent, children } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "app://img.png", width: 4096, height: 3072 });
    const map = lastMap();
    expect(children).toHaveLength(1);
    expect(children[0]?.cls).toBe("mythical-map-leaflet");
    expect(map.container).toBe(children[0]);
    expect(map.options.crs).toBe(CRS.Simple);
    expect(handle.bounds).toEqual(boundsFor(4096, 3072));
    expect(handle.bounds).toEqual([
      [-192, 0],
      [0, 256],
    ]);
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]?.url).toBe("app://img.png");
    expect(map.layers[0]?.bounds).toEqual(handle.bounds);
  });

  it("leaves the overlay to the image layer when the image may be cached, and frees it on destroy", () => {
    const { parent } = fakeParent(800, 600);
    let reads = 0;
    const imageSource = {
      extension: "png",
      // Never resolves: nothing may be shown while the image is being prepared.
      read: () => (reads++, new Promise<ArrayBuffer>(() => {})),
    };
    const handle = mountBaseMap(parent, { imageUrl: "app://img.png", imageSource, width: 8192, height: 6144 });
    expect(reads).toBe(1);
    expect(lastMap().layers).toEqual([]);
    handle.destroy();
  });

  it("removes the image overlay on destroy", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "app://img.png", width: 100, height: 100 });
    const map = lastMap();
    handle.destroy();
    expect(map.layers).toEqual([]);
  });

  it("draws no overlay when the image is missing", () => {
    const { parent } = fakeParent(800, 600);
    mountBaseMap(parent, { imageUrl: null, width: 100, height: 100 });
    expect(lastMap().layers).toEqual([]);
  });

  it("fits right away when the container is visible", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    const map = lastMap();
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "fitBounds"]);
    expect(map.calls[2]?.args[0]).toEqual(handle.bounds);
  });

  it("defers the fit until the ResizeObserver sees a non-zero size (background tab)", () => {
    const { parent, children } = fakeParent(0, 0);
    mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    const map = lastMap();
    const ro = FakeResizeObserver.instances[0];
    expect(ro?.observed).toEqual([children[0]]);
    expect(map.callNames).toEqual([]);
    const el = children[0] as FakeEl;
    el.clientWidth = 640;
    el.clientHeight = 480;
    ro?.callback();
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "fitBounds"]);
    el.clientWidth = 320;
    ro?.callback();
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "fitBounds", "invalidateSize", "setMinZoom"]);
  });

  it("refresh() invalidates the size (onResize) without refitting", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    handle.refresh();
    expect(lastMap().callNames).toEqual(["invalidateSize", "setMinZoom", "fitBounds", "invalidateSize", "setMinZoom"]);
  });

  it("destroy() removes the map, disconnects the observer and is idempotent", () => {
    const { parent, children } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    handle.destroy();
    handle.destroy();
    handle.refresh();
    const map = lastMap();
    expect(map.removed).toBe(true);
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
    expect(children[0]?.removed).toBe(true);
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "fitBounds"]);
    expect(handle.currentViewport()).toBeNull();
  });

  it("installs the pop-out shim on Leaflet's Draggable", () => {
    const { parent } = fakeParent(800, 600);
    mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    const down = Draggable.prototype._onDown as unknown as Record<symbol, unknown>;
    expect(down[Symbol.for("mythical-maps.popoutShim")]).toBe(true);
  });
});

describe("zoom limits and opening viewport", () => {
  it("sets maxZoom to z + 2 and zoom steps from one place", () => {
    const { parent } = fakeParent(800, 600);
    mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072 });
    expect(lastMap().options).toMatchObject({ maxZoom: 6, zoomSnap: ZOOM_SNAP, zoomDelta: ZOOM_DELTA });
    expect(lastMap().options.minZoom).toBe(fitZoom(4096, 3072, 800, 600));
  });

  it("turns off Leaflet's wheel zoom and attaches the smooth wheel handler to the container", () => {
    const { parent, children } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072 });
    expect(lastMap().options.scrollWheelZoom).toBe(false);
    const el = children[0] as FakeEl;
    expect(el.listeners).toEqual([["wheel", { passive: false }]]);
    handle.destroy();
    expect(el.listeners).toEqual([]);
  });

  it("has no limits and no viewport until the container has a size", () => {
    const { parent, children } = fakeParent(0, 0);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072 });
    expect(handle.limits).toBeNull();
    expect(handle.currentViewport()).toBeNull();
    expect(lastMap().options.minZoom).toBeUndefined();
    const el = children[0] as FakeEl;
    el.clientWidth = 1024;
    el.clientHeight = 768;
    FakeResizeObserver.instances[0]?.callback();
    // 1024 / 4096 = 1/4 → fit at z - 2.
    expect(handle.limits).toEqual({ min: 2, max: 6 });
  });

  it("recomputes minZoom (fit) when the container is resized", () => {
    const { parent, children } = fakeParent(1024, 768);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072 });
    expect(handle.limits?.min).toBe(2);
    const el = children[0] as FakeEl;
    el.clientWidth = 2048;
    el.clientHeight = 1536;
    FakeResizeObserver.instances[0]?.callback();
    expect(handle.limits?.min).toBe(3);
    expect(lastMap().options.minZoom).toBe(3);
  });

  it("opens at the saved viewport instead of fitting", () => {
    const { parent } = fakeParent(1024, 768);
    mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072, viewport: { center: [-96, 128], zoom: 3 } });
    const map = lastMap();
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "setView"]);
    expect(map.calls[2]?.args.slice(0, 2)).toEqual([[-96, 128], 3]);
  });

  it("clamps the saved zoom to the limits (a new map's zoom 0 opens at fit)", () => {
    const { parent } = fakeParent(1024, 768);
    mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072, viewport: { center: [-96, 128], zoom: 0 } });
    expect(lastMap().zoom).toBe(2);
    mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072, viewport: { center: [-96, 128], zoom: 9 } });
    expect(lastMap().zoom).toBe(6);
  });

  it("defers the saved viewport until the container has a size", () => {
    const { parent, children } = fakeParent(0, 0);
    mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072, viewport: { center: [-10, 20], zoom: 4 } });
    const map = lastMap();
    expect(map.callNames).toEqual([]);
    const el = children[0] as FakeEl;
    el.clientWidth = 800;
    el.clientHeight = 600;
    FakeResizeObserver.instances[0]?.callback();
    expect(map.callNames).toEqual(["invalidateSize", "setMinZoom", "setView"]);
    expect(map.center).toEqual([-10, 20]);
  });

  it("currentViewport reads the live centre and zoom, rounded", () => {
    const { parent } = fakeParent(1024, 768);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072 });
    lastMap().setView([-95.123456789, 127.98765432], 3.14159);
    expect(handle.currentViewport()).toEqual({ center: [-95.1235, 127.9877], zoom: 3.142 });
  });
});

describe("feature rendering (bead 4.3)", () => {
  const model = (features: Feature[]): MapDocument => ({
    type: "mythical-map",
    version: 1,
    image: { path: "x.png", width: 512, height: 512 },
    features,
  });
  const region: Feature = { id: "rreg0001", type: "region", rank: "a0", polygon: [[0, 0], [0, 1], [1, 1]] };
  const path: Feature = { id: "hpth0001", type: "path", rank: "a1", polyline: [[0, 0], [1, 1]] };

  beforeEach(() => {
    featureLayers.length = 0;
  });

  it("render draws features on the map, also when the image is missing", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: null, width: 512, height: 512 });
    handle.render(model([region, path]));
    expect(featureLayers.map((l) => [l.kind, l.map])).toEqual([
      ["polygon", lastMap()],
      ["polyline", lastMap()],
    ]);
    handle.render(model([region]));
    expect(featureLayers[1]?.removed).toBe(true);
  });

  it("draws pin glyphs with the injected icons, in the container's document", () => {
    const { parent } = fakeParent(800, 600);
    const made: { className: string; icon?: string }[] = [];
    const doc = (parent as unknown as { ownerDocument: Record<string, unknown> }).ownerDocument;
    doc.createElement = () => {
      const el = { className: "", textContent: "", icon: undefined as string | undefined, style: { setProperty() {} }, appendChild: (c: unknown) => c };
      made.push(el);
      return el;
    };
    const set: string[] = [];
    const handle = mountBaseMap(parent, {
      imageUrl: "x",
      width: 512,
      height: 512,
      icons: { has: () => true, set: (_el, n) => set.push(n) },
    });
    handle.render(model([{ id: "ppin0001", type: "pin", rank: "a0", pos: [-1, 1], style: { iconGlyph: "castle" } }]));
    expect(set).toEqual(["castle"]);
    const icon = (featureLayers[0] as MockFeatureLayer).options.icon as MockDivIcon;
    expect(made).toContain(icon.options.html);
    delete doc.createElement;
  });

  it("without icons every glyph falls back to a dot", () => {
    const { parent } = fakeParent(800, 600);
    const classes: string[] = [];
    const doc = (parent as unknown as { ownerDocument: Record<string, unknown> }).ownerDocument;
    doc.createElement = () => {
      const el = { className: "", style: { setProperty() {} }, appendChild: (c: unknown) => c };
      return new Proxy(el, {
        set(t, k, v) {
          if (k === "className") classes.push(String(v));
          return Reflect.set(t, k, v);
        },
      });
    };
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    handle.render(model([{ id: "ppin0001", type: "pin", rank: "a0", pos: [-1, 1] }]));
    expect(classes).toContain("mythical-map-pin-dot");
    delete doc.createElement;
  });

  it("destroy removes feature layers before the map, and later renders do nothing", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    handle.render(model([region]));
    const layer = featureLayers[0] as MockFeatureLayer;
    const map = lastMap();
    let mapRemovedFirst = false;
    const remove = layer.remove.bind(layer);
    layer.remove = () => {
      mapRemovedFirst = map.removed;
      return remove();
    };
    handle.destroy();
    expect(layer.removed).toBe(true);
    expect(mapRemovedFirst).toBe(false);
    expect(map.removed).toBe(true);
    handle.render(model([region, path]));
    expect(featureLayers).toHaveLength(1);
  });
});

describe("visibility (bead 4.4)", () => {
  const allTypes = (): MapDocument => {
    const file = fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url));
    const res = parseMap(readFileSync(file, "utf8"));
    if (!res.ok) throw new Error("all-types.map failed to parse");
    return res.map;
  };
  /** Positions of the layers currently on the map. */
  const drawn = (): unknown[] => featureLayers.filter((l) => l.map !== null).map((l) => l.latlngs);
  const KEEP = [-144, 192];
  const WILD_COAST = [-160, 32];

  beforeEach(() => {
    featureLayers.length = 0;
  });

  // 4096 x 3072 in 1024 x 768: limits {min 2, max 6}, so [0.5, 1] starts at zoom 4.
  const mount = (w = 1024, h = 768) => {
    const { parent, children } = fakeParent(w, h);
    // Pins and labels build DOM; a minimal element is enough here.
    (parent as unknown as { ownerDocument: Record<string, unknown> }).ownerDocument.createElement = () => ({
      className: "",
      textContent: "",
      style: { setProperty() {} },
      appendChild: (c: unknown) => c,
    });
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 4096, height: 3072, viewport: { center: [-96, 128], zoom: 2 } });
    return { handle, map: lastMap(), el: children[0] as FakeEl };
  };

  it("does not draw features inside a hidden folder", () => {
    const { handle } = mount();
    handle.render(allTypes());
    expect(drawn()).not.toContainEqual(KEEP);
    expect(drawn()).toContainEqual([-64, 96]); // Rusty Flagon, in the shown folder "Towns"
    const shown = allTypes();
    shown.features = shown.features.map((f) => (f.id === "fsecrt01" ? { ...f, isHidden: false } : f));
    handle.render(shown);
    expect(drawn()).toContainEqual(KEEP);
  });

  it("a zoom-gated label is hidden at min zoom and appears past the midpoint, during and after a zoom", () => {
    const { handle, map } = mount();
    handle.render(allTypes());
    expect(drawn()).not.toContainEqual(WILD_COAST);
    map.setView(map.center, 4.2);
    map.fire("zoom"); // a continuous zoom step, before zoomend
    expect(drawn()).toContainEqual(WILD_COAST);
    map.setView(map.center, 3.5);
    map.fire("zoomend");
    expect(drawn()).not.toContainEqual(WILD_COAST);
  });

  it("does not re-render while the visible set is unchanged", () => {
    const { handle, map } = mount();
    handle.render(allTypes());
    const westmarch = featureLayers.find((l) => JSON.stringify(l.latlngs) === "[-96,128]") as MockFeatureLayer;
    const before = westmarch.calls.length;
    map.setView(map.center, 2.5);
    map.fire("zoom");
    map.setView(map.center, 3.9);
    map.fire("zoomend");
    expect(westmarch.calls.length).toBe(before);
    map.setView(map.center, 4);
    map.fire("zoomend");
    expect(westmarch.callNames.slice(before)).toContain("setLatLng"); // re-rendered once the label appeared
  });

  it("re-evaluates when the zoom limits change on resize", () => {
    const { handle, map, el } = mount();
    handle.render(allTypes());
    map.setView(map.center, 4);
    map.fire("zoomend");
    expect(drawn()).toContainEqual(WILD_COAST);
    // 2048 x 1536 → min 3, so [0.5, 1] now starts at 4.5; the zoom stays 4.
    el.clientWidth = 2048;
    el.clientHeight = 1536;
    FakeResizeObserver.instances.at(-1)?.callback();
    expect(handle.limits).toEqual({ min: 3, max: 6 });
    expect(drawn()).not.toContainEqual(WILD_COAST);
  });

  it("labels pop in mid-zoom during the smooth wheel zoom loop (bead 4.6)", () => {
    const frames: ((t: number) => void)[] = [];
    const { handle, map, el } = mount();
    Object.assign(el.ownerDocument.defaultView, {
      requestAnimationFrame: (cb: (t: number) => void) => frames.push(cb),
      cancelAnimationFrame: () => {},
    });
    handle.render(allTypes());
    expect(drawn()).not.toContainEqual(WILD_COAST);
    const wheel = el.handlers.wheel as (e: unknown) => void;
    for (let i = 0; i < 20; i++) wheel({ deltaY: -1000, deltaMode: 0, ctrlKey: false, preventDefault() {} });
    let appearedAt: number | null = null;
    let t = 0;
    while (frames.length > 0 && t < 10_000) {
      (frames.shift() as (t: number) => void)((t += 16));
      if (appearedAt === null && drawn().some((p) => JSON.stringify(p) === JSON.stringify(WILD_COAST))) appearedAt = map.zoom;
    }
    expect(map.zoom).toBe(6); // the loop eased all the way to maxZoom
    expect(appearedAt).not.toBeNull();
    expect(appearedAt as number).toBeGreaterThanOrEqual(4);
    expect(appearedAt as number).toBeLessThan(6); // during the zoom, not at its end
  });

  it("destroy removes the zoom listeners", () => {
    const { handle, map } = mount();
    expect(map.listeners.zoom).toHaveLength(1);
    expect(map.listeners.zoomend).toHaveLength(1);
    handle.destroy();
    expect(map.listeners.zoom).toHaveLength(0);
    expect(map.listeners.zoomend).toHaveLength(0);
  });
});
