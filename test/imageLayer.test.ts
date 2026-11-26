import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { created, map as createMap, type MockImageOverlay, type MockMap } from "./mocks/leaflet";
import { addImageLayer, type ImageSource } from "../src/ui/imageLayer";
import type { Bounds } from "../src/core/frame";

const bounds: Bounds = [
  [-256, 0],
  [0, 192],
];

class FakeCanvas {
  width = 300;
  height = 150;
  classes: string[] = [];
  drawn: unknown[][] = [];
  context: { drawImage: (...args: unknown[]) => void } | null = {
    drawImage: (...args) => void this.drawn.push(args),
  };
  listeners: Record<string, Array<() => void>> = {};
  classList = { add: (c: string) => void this.classes.push(c) };
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

function setup(options: { bitmap?: [number, number]; noContext?: boolean; throwOnDraw?: boolean; decodeFails?: boolean } = {}) {
  const canvases: FakeCanvas[] = [];
  const bitmaps: FakeBitmap[] = [];
  const blobs: Blob[] = [];
  const ownerDocument = {
    createElement(tag: string): FakeCanvas {
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
      createImageBitmap(blob: Blob): Promise<FakeBitmap> {
        blobs.push(blob);
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
  return { map, add, canvases, bitmaps, blobs };
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

const settle = () => new Promise((r) => setTimeout(r, 0));
const urls = (map: MockMap) => map.layers.map((l) => l.url);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  created.maps.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("addImageLayer: cached image", () => {
  it("shows nothing until the canvas is drawn, then adds the canvas overlay", async () => {
    const t = setup();
    t.add(source());
    expect(t.map.layers).toEqual([]);
    await settle();
    const [canvas] = t.canvases;
    expect(t.map.layers).toHaveLength(1);
    const layer = t.map.layers[0] as MockImageOverlay;
    expect(layer._image).toBe(canvas);
    expect(layer.bounds).toEqual(bounds);
    expect(layer.options).toEqual({ interactive: false, pane: "tilePane" });
    expect(canvas?.classes).toEqual(["leaflet-image-layer", "leaflet-zoom-animated"]);
  });

  it("sizes the canvas to the decoded image, draws it once and closes the bitmap", async () => {
    const t = setup({ bitmap: [6000, 8000] });
    t.add(source("jpg"));
    await settle();
    const [canvas] = t.canvases;
    expect([canvas?.width, canvas?.height]).toEqual([6000, 8000]);
    expect(canvas?.drawn).toEqual([[t.bitmaps[0], 0, 0]]);
    expect(t.bitmaps[0]?.closed).toBe(true);
    expect(t.blobs[0]?.type).toBe("image/jpeg");
    expect(t.blobs[0]?.size).toBe(8);
  });

  it("redraws into the same canvas when its context is restored", async () => {
    const t = setup();
    const from = source();
    t.add(from);
    await settle();
    t.canvases[0]?.fire("contextrestored");
    await settle();
    expect(from.reads).toBe(2);
    expect(t.canvases).toHaveLength(1);
    expect(t.canvases[0]?.drawn).toHaveLength(2);
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

  it("removes the layer, frees the canvas and stops listening", async () => {
    const t = setup();
    const from = source();
    const handle = t.add(from);
    await settle();
    handle.destroy();
    handle.destroy();
    const [canvas] = t.canvases;
    expect(t.map.layers).toEqual([]);
    expect([canvas?.width, canvas?.height]).toEqual([0, 0]);
    expect(canvas?.listeners.contextrestored).toEqual([]);
  });

  it("removes an ordinary image too", () => {
    const t = setup();
    t.add(undefined).destroy();
    expect(t.map.layers).toEqual([]);
  });
});
