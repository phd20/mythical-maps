/**
 * The map's image layer (design D1, D2, D3 and D5 of `cached-map-image`).
 *
 * An ordinary image is an `L.imageOverlay` (`<img>`), which the renderer may
 * have to decode again after a pause, stalling the next zoom. A large still
 * raster image is instead decoded once from its bytes and drawn into canvases,
 * which are held while the map is open:
 *
 * - Nothing is shown until the canvases are drawn, so the image is decoded once.
 * - Besides the full size there are halved copies (design D6), because a canvas
 *   drawn much smaller than itself looks grainy. One is displayed at a time,
 *   chosen from the size the image has on screen.
 * - Any failure falls back to the `<img>` overlay.
 * - `destroy()` frees the canvases at once and discards work still in progress.
 * - They are created in the container's own document and redrawn if a context is
 *   restored after being lost.
 *
 * The canvases go in the tile pane, so features stay above them even though they
 * are added after them.
 */
import * as L from "leaflet";
import { isAnimatedImage, isCacheableSize, levelFor, levelSizes, mayCacheImage } from "../core/imageCache";
import type { Bounds } from "../core/frame";

/** Where the bytes of a cacheable image come from. */
export interface ImageSource {
  /** The image file's extension, without the dot. */
  extension: string;
  read(): Promise<ArrayBuffer>;
}

export interface ImageLayerOptions {
  /** Resource URL for the `<img>` overlay. */
  imageUrl: string;
  bounds: Bounds;
  /** Image size in pixels, from the map file. */
  width: number;
  height: number;
  /** Without it the image is never cached. */
  source?: ImageSource;
}

export interface ImageLayerHandle {
  /** Remove the layer and free the canvases. Idempotent. */
  destroy(): void;
}

/** Marks the displayed copy (see `styles.css`). */
const SHOWN_CLASS = "mythical-map-image-shown";
/** Map events after which the image may have a different size on screen. */
const SIZE_EVENTS = "zoom zoomend moveend resize";

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};

type DecodeWindow = Window & typeof globalThis;

/** The parts of Leaflet's overlay that adopting an element touches. */
interface AdoptingOverlay {
  _url: HTMLElement;
  _image: HTMLElement;
  _zoomAnimated: boolean;
}

/**
 * An image overlay whose element is the one given. Leaflet then places, sizes
 * and zoom-animates it exactly like an `<img>`. `_initImage` is private Leaflet
 * API (pinned at 1.9.4).
 */
function elementOverlay(element: HTMLElement, bounds: Bounds): L.ImageOverlay {
  const ElementOverlay = L.ImageOverlay.extend({
    _initImage(this: AdoptingOverlay): void {
      const el = (this._image = this._url);
      el.classList.add("leaflet-image-layer");
      if (this._zoomAnimated) el.classList.add("leaflet-zoom-animated");
    },
  }) as unknown as new (element: HTMLElement, bounds: Bounds, options: L.ImageOverlayOptions) => L.ImageOverlay;
  return new ElementOverlay(element, bounds, { interactive: false, pane: "tilePane" });
}

export function addImageLayer(map: L.Map, container: HTMLElement, options: ImageLayerOptions): ImageLayerHandle {
  const { imageUrl, bounds, width, height, source } = options;
  let destroyed = false;
  let layer: L.Layer | null = null;
  /** The cached copies, largest first; empty when the image is not cached. */
  let canvases: HTMLCanvasElement[] = [];
  /** Only the newest preparation may draw. */
  let generation = 0;

  /** The container's own window (pop-outs have their own). */
  const ownWindow = (): DecodeWindow => (container.ownerDocument.defaultView ?? globalThis) as DecodeWindow;

  /** Display the copy that suits the size the image now has on screen. */
  const showLevel = (): void => {
    const full = canvases[0];
    if (!full) return;
    // CRS.Simple: one map unit is 2^zoom CSS pixels. Unknown until the first view.
    const unit = 2 ** map.getZoom() * (ownWindow().devicePixelRatio || 1);
    const [[south, west], [north, east]] = bounds;
    const scale = Math.max(((east - west) * unit) / full.width, ((north - south) * unit) / full.height);
    const shown = levelFor(scale, canvases.length);
    canvases.forEach((c, i) => c.classList.toggle(SHOWN_CLASS, i === shown));
  };

  const release = (): void => {
    map.off(SIZE_EVENTS, showLevel);
    layer?.remove();
    layer = null;
    for (const canvas of canvases) {
      canvas.removeEventListener("contextrestored", onRestored);
      // A zero-sized canvas gives its memory back without waiting for collection.
      canvas.width = 0;
      canvas.height = 0;
    }
    canvases = [];
  };

  const showImage = (): void => {
    release();
    layer = L.imageOverlay(imageUrl, bounds, { interactive: false }).addTo(map);
  };

  /** Draw `image` into `canvas` at the image's size; false without a 2d context. */
  const paint = (canvas: HTMLCanvasElement, image: ImageBitmap): boolean => {
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context?.drawImage(image, 0, 0);
    return context !== null;
  };

  /** Decode the bytes and draw the copies; false when this image should stay an `<img>`. */
  const draw = async (from: ImageSource, isCurrent: () => boolean): Promise<boolean> => {
    const bytes = await from.read();
    if (!isCurrent()) return true;
    if (isAnimatedImage(new Uint8Array(bytes))) return false;
    const doc = container.ownerDocument;
    const win = ownWindow();
    // Decoding a Blob happens off the main thread.
    const type = MIME_TYPES[from.extension.toLowerCase()] ?? "";
    const bitmap = await win.createImageBitmap(new Blob([bytes], { type }));
    try {
      if (!isCurrent()) return true;
      // The map file's size can disagree with the image, so check the real one.
      if (!isCacheableSize(bitmap.width, bitmap.height)) return false;
      // A redraw after a lost context reuses the canvases already on the map.
      const first = layer === null;
      let copy = bitmap;
      try {
        for (const [i, size] of levelSizes(bitmap.width, bitmap.height).entries()) {
          if (i > 0) {
            // Let a frame through between the heavy steps, so they don't add up to a freeze.
            await new Promise<void>((resolve) => win.setTimeout(resolve, 0));
            if (!isCurrent()) return true;
            // Halving the previous copy averages pixels as an `<img>`'s smaller
            // copies do, and holds the main thread far less than "high" quality.
            const half = await win.createImageBitmap(copy, {
              resizeWidth: size.width,
              resizeHeight: size.height,
              resizeQuality: "low",
            });
            if (copy !== bitmap) copy.close();
            copy = half;
            if (!isCurrent()) return true;
          }
          let canvas = canvases[i];
          if (!canvas) {
            canvas = canvases[i] = doc.createElement("canvas");
            canvas.addEventListener("contextrestored", onRestored);
          }
          if (!paint(canvas, copy)) return false;
        }
      } finally {
        if (copy !== bitmap) copy.close();
      }
      if (first) {
        const element = doc.createElement("div");
        element.classList.add("mythical-map-image-levels");
        for (const canvas of canvases) element.appendChild(canvas);
        map.on(SIZE_EVENTS, showLevel);
        showLevel();
        layer = elementOverlay(element, bounds).addTo(map);
      }
      return true;
    } finally {
      bitmap.close();
    }
  };

  const prepare = (from: ImageSource): void => {
    const mine = ++generation;
    const isCurrent = (): boolean => !destroyed && mine === generation;
    void draw(from, isCurrent).then(
      (drawn) => {
        if (!drawn && isCurrent()) showImage();
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        console.warn("[mythical-maps] could not cache the map image", error);
        showImage();
      },
    );
  };

  function onRestored(): void {
    if (source && !destroyed) prepare(source);
  }

  if (source && mayCacheImage(source.extension, width, height)) prepare(source);
  else showImage();

  return {
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      release();
    },
  };
}
