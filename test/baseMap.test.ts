import { beforeEach, describe, expect, it } from "vitest";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { created, CRS, Draggable, type MockMap } from "./mocks/leaflet";
import { mountBaseMap } from "../src/ui/baseMap";
import { boundsFor } from "../src/core/frame";
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
