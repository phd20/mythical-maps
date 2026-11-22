import { beforeEach, describe, expect, it } from "vitest";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { created, CRS, Draggable, type MockMap } from "./mocks/leaflet";
import { mountBaseMap } from "../src/ui/baseMap";
import { boundsFor } from "../src/core/frame";

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
    expect(map.callNames).toEqual(["invalidateSize", "fitBounds"]);
    expect(map.calls[1]?.args[0]).toEqual(handle.bounds);
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
    expect(map.callNames).toEqual(["invalidateSize", "fitBounds"]);
    el.clientWidth = 320;
    ro?.callback();
    expect(map.callNames).toEqual(["invalidateSize", "fitBounds", "invalidateSize"]);
  });

  it("refresh() invalidates the size (onResize) without refitting", () => {
    const { parent } = fakeParent(800, 600);
    const handle = mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    handle.refresh();
    expect(lastMap().callNames).toEqual(["invalidateSize", "fitBounds", "invalidateSize"]);
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
    expect(map.callNames).toEqual(["invalidateSize", "fitBounds"]);
  });

  it("installs the pop-out shim on Leaflet's Draggable", () => {
    const { parent } = fakeParent(800, 600);
    mountBaseMap(parent, { imageUrl: "x", width: 512, height: 512 });
    const down = Draggable.prototype._onDown as unknown as Record<symbol, unknown>;
    expect(down[Symbol.for("mythical-maps.popoutShim")]).toBe(true);
  });
});
