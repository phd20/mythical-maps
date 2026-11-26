import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { created, map as createMap, type MockImageOverlay, type MockMap } from "./mocks/leaflet";
import { addImageLayer, type ImageSource } from "../src/ui/imageLayer";
import type { Bounds } from "../src/core/frame";

const bounds: Bounds = [
  [-256, 0],
  [0, 192],
];

class FakeClassList {
  names = new Set<string>();
  add(c: string): void {
    this.names.add(c);
  }
  toggle(c: string, on: boolean): void {
    if (on) this.names.add(c);
    else this.names.delete(c);
  }
}

class FakeDiv {
  classList = new FakeClassList();
  children: FakeCanvas[] = [];
  appendChild(c: FakeCanvas): void {
    this.children.push(c);
  }
}

class FakeCanvas {
  width = 300;
  height = 150;
  classList = new FakeClassList();
  get shown(): boolean {
    return this.classList.names.has("mythical-map-image-shown");
  }
  drawn: unknown[][] = [];
  context: { drawImage: (...args: unknown[]) => void } | null = {
    drawImage: (...args) => void this.drawn.push(args),
  };
  listeners: Record<string, Array<() => void>> = {};
  getContext(): FakeCanvas["context"] {
    return this.context;
  }
  addEventListener(type: string, fn: () => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  fire(type: string): void {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

class FakeBitmap {
  closed = false;
  constructor(
    public width: number,
    public height: number,
  ) {}
  close(): void {
    this.closed = true;
  }
}

function setup(options: { bitmap?: [number, number]; noContext?: boolean; throwOnDraw?: boolean; decodeFails?: boolean; dpr?: number } = {}) {
  const canvases: FakeCanvas[] = [];
  const divs: FakeDiv[] = [];
  const bitmaps: FakeBitmap[] = [];
  const blobs: Blob[] = [];
  const ownerDocument = {
    createElement(tag: string): FakeCanvas | FakeDiv {
      if (tag === "div") {
        const div = new FakeDiv();
        divs.push(div);
        return div;
      }
      expect(tag).toBe("canvas");
      const c = new FakeCanvas();
      if (options.noContext) c.context = null;
      if (options.throwOnDraw) {
        c.context = {
          drawImage: () => {
            throw new Error("draw failed");
          },
        };
      }
      canvases.push(c);
      return c;
    },
    defaultView: {
      devicePixelRatio: options.dpr ?? 1,
      setTimeout(fn: () => void): void {
        setTimeout(fn, 0);
      },
      createImageBitmap(from: Blob | FakeBitmap, resize?: ImageBitmapOptions): Promise<FakeBitmap> {
        if (from instanceof FakeBitmap) {
          expect(resize?.resizeQuality).toBe("low");
          // Each copy is made from the one twice its size.
          expect(from.closed).toBe(false);
          expect(from.width).toBe((resize?.resizeWidth ?? 0) * 2);
          const copy = new FakeBitmap(resize?.resizeWidth ?? 0, resize?.resizeHeight ?? 0);
          bitmaps.push(copy);
          return Promise.resolve(copy);
        }
        blobs.push(from);
        if (options.decodeFails) return Promise.reject(new Error("bad image"));
        const bitmap = new FakeBitmap(...(options.bitmap ?? [6144, 8192]));
        bitmaps.push(bitmap);
        return Promise.resolve(bitmap);
      },
    },
  };
  const map = createMap({}) as MockMap;
  const container = { ownerDocument } as unknown as HTMLElement;
  const add = (source: ImageSource | undefined, width = 6144, height = 8192) =>
    addImageLayer(map as never, container, { imageUrl: "app://map.webp", bounds, width, height, ...(source ? { source } : {}) });
  return { map, add, canvases, divs, bitmaps, blobs };
}

/** A source whose read resolves when the test says so. */
function source(extension = "webp", bytes: ArrayBuffer = new ArrayBuffer(8)) {
  let reads = 0;
  return {
    extension,
    get reads() {
      return reads;
    },
    read(): Promise<ArrayBuffer> {
      reads++;
      return Promise.resolve(bytes);
    },
  };
}

/** Several turns of the event loop: the layer yields between copies. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const urls = (map: MockMap) => map.layers.map((l) => l.url);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  created.maps.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("addImageLayer: cached image", () => {
  it("shows nothing until the canvases are drawn, then adds one overlay holding them", async () => {
    const t = setup();
    t.add(source());
    expect(t.map.layers).toEqual([]);
    await settle();
    const [element] = t.divs;
    expect(t.map.layers).toHaveLength(1);
    const layer = t.map.layers[0] as MockImageOverlay;
    expect(layer._image).toBe(element);
    expect(layer.bounds).toEqual(bounds);
    expect(layer.options).toEqual({ interactive: false, pane: "tilePane" });
    expect([...(element?.classList.names ?? [])]).toEqual(["mythical-map-image-levels", "leaflet-image-layer", "leaflet-zoom-animated"]);
    expect(element?.children).toEqual(t.canvases);
  });

  it("draws the image and its halved copies once and closes every bitmap", async () => {
    const t = setup({ bitmap: [6000, 8000] });
    t.add(source("jpg"));
    await settle();
    expect(t.canvases.map((c) => [c.width, c.height])).toEqual([
      [6000, 8000],
      [3000, 4000],
      [1500, 2000],
      [750, 1000],
    ]);
    expect(t.canvases.map((c) => c.drawn)).toEqual(t.bitmaps.map((b) => [[b, 0, 0]]));
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
    expect(t.blobs[0]?.type).toBe("image/jpeg");
    expect(t.blobs[0]?.size).toBe(8);
  });

  // The bounds are 192 map units wide for 6144 pixels, so zoom 5 is native size.
  it.each([
    [5, 1, 0],
    [4, 1, 1],
    [3, 1, 2],
    [2, 1, 3],
    [-3, 1, 3],
    [7, 1, 0],
    [3, 2, 1],
  ])("at zoom %d with pixel ratio %d displays copy %d only", async (zoom, dpr, shown) => {
    const t = setup({ dpr });
    t.map.zoom = zoom;
    t.add(source());
    await settle();
    expect(t.canvases.map((c) => c.shown)).toEqual(t.canvases.map((_c, i) => i === shown));
  });

  it("changes the displayed copy as the map zooms, moves or resizes", async () => {
    const t = setup();
    t.map.zoom = 5;
    t.add(source());
    await settle();
    for (const [event, zoom, level] of [
      ["zoom", 3.5, 1],
      ["zoomend", 2.5, 2],
      ["moveend", 4.5, 0],
      ["resize", 2, 3],
    ] as const) {
      t.map.zoom = zoom;
      t.map.fire(event);
      expect(t.canvases.map((c) => c.shown)).toEqual(t.canvases.map((_c, i) => i === level));
    }
  });

  it("redraws into the same canvases when a context is restored", async () => {
    const t = setup();
    const from = source();
    t.add(from);
    await settle();
    t.canvases[2]?.fire("contextrestored");
    await settle();
    expect(from.reads).toBe(2);
    expect(t.canvases).toHaveLength(4);
    expect(t.canvases.every((c) => c.drawn.length === 2)).toBe(true);
    expect(t.divs).toHaveLength(1);
    expect(t.map.layers).toHaveLength(1);
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
  });
});

describe("addImageLayer: ordinary image", () => {
  const expectImage = (t: ReturnType<typeof setup>) => {
    expect(urls(t.map)).toEqual(["app://map.webp"]);
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
    expect(t.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  };

  it("is used at once without a source, for SVG and GIF, and for small images", () => {
    for (const [from, size] of [
      [undefined, 6144],
      [source("svg"), 6144],
      [source("gif"), 6144],
      [source("png"), 512],
    ] as const) {
      const t = setup();
      t.add(from, size, size);
      expectImage(t);
      expect(from?.reads ?? 0).toBe(0);
    }
  });

  it("is used for an animated image", async () => {
    const bytes = new Uint8Array(32);
    bytes.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    bytes.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    bytes[20] = 0x02;
    const t = setup();
    t.add(source("webp", bytes.buffer));
    await settle();
    expectImage(t);
    expect(t.blobs).toEqual([]);
  });

  it.each([
    ["the file cannot be read", {}, true],
    ["the image cannot be decoded", { decodeFails: true }, false],
    ["there is no 2d context", { noContext: true }, false],
    ["drawing throws", { throwOnDraw: true }, false],
    ["the decoded image is over the limits", { bitmap: [20_000, 1000] as [number, number] }, false],
  ])("is used when %s", async (_name, options, readFails) => {
    const t = setup(options);
    t.add(readFails ? { extension: "png", read: () => Promise.reject(new Error("gone")) } : source("png"));
    await settle();
    expectImage(t);
  });

  it("replaces the canvas when it cannot be redrawn", async () => {
    const t = setup();
    let fail = false;
    t.add({ extension: "png", read: () => (fail ? Promise.reject(new Error("gone")) : Promise.resolve(new ArrayBuffer(8))) });
    await settle();
    fail = true;
    t.canvases[0]?.fire("contextrestored");
    await settle();
    expectImage(t);
    expect(t.canvases[0]?.listeners.contextrestored).toEqual([]);
  });
});

describe("addImageLayer: destroy", () => {
  it("adds nothing when destroyed while reading", async () => {
    const t = setup();
    t.add(source()).destroy();
    await settle();
    expect(t.map.layers).toEqual([]);
    expect(t.canvases).toEqual([]);
    expect(t.blobs).toEqual([]);
  });

  it("closes a bitmap that arrives after destroy", async () => {
    const t = setup();
    let handle: { destroy(): void } | null = null;
    handle = t.add({
      extension: "png",
      read: async () => {
        // Destroy after the read, while the decode is pending.
        queueMicrotask(() => queueMicrotask(() => handle?.destroy()));
        return new ArrayBuffer(8);
      },
    });
    await settle();
    expect(t.bitmaps).toHaveLength(1);
    expect(t.bitmaps[0]?.closed).toBe(true);
    expect(t.canvases).toEqual([]);
    expect(t.map.layers).toEqual([]);
  });

  it("does not fall back when a destroyed layer's read fails", async () => {
    const t = setup();
    t.add({ extension: "png", read: () => Promise.reject(new Error("gone")) }).destroy();
    await settle();
    expect(t.map.layers).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops between copies when destroyed", async () => {
    const t = setup();
    let handle: { destroy(): void } | null = null;
    const original = FakeCanvas.prototype.getContext;
    // Destroy just after the first canvas has been drawn.
    const spy = vi.spyOn(FakeCanvas.prototype, "getContext").mockImplementation(function (this: FakeCanvas) {
      queueMicrotask(() => handle?.destroy());
      return original.call(this);
    });
    handle = t.add(source());
    await settle();
    spy.mockRestore();
    expect(t.canvases).toHaveLength(1);
    expect(t.map.layers).toEqual([]);
    expect(t.bitmaps.every((b) => b.closed)).toBe(true);
    expect(t.canvases[0]?.width).toBe(0);
  });

  it("removes the layer, frees every canvas and stops listening", async () => {
    const t = setup();
    const from = source();
    const handle = t.add(from);
    await settle();
    handle.destroy();
    handle.destroy();
    expect(t.map.layers).toEqual([]);
    expect(t.canvases).toHaveLength(4);
    expect(t.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
    expect(t.canvases.every((c) => c.listeners.contextrestored?.length === 0)).toBe(true);
    expect(Object.values(t.map.listeners).flat()).toEqual([]);
  });

  it("removes an ordinary image too", () => {
    const t = setup();
    t.add(undefined).destroy();
    expect(t.map.layers).toEqual([]);
  });
});
