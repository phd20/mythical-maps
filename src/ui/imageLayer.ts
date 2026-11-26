/**
 * The map's image layer (design D1, D2, D3 and D5 of `cached-map-image`).
 *
 * An ordinary image is an `L.imageOverlay` (`<img>`), which the renderer may
 * have to decode again after a pause, stalling the next zoom. A large still
 * raster image is instead decoded once from its bytes and drawn into one
 * canvas, which is held while the map is open:
 *
 * - Nothing is shown until the canvas is drawn, so the image is decoded once.
 * - Any failure falls back to the `<img>` overlay.
 * - `destroy()` frees the canvas at once and discards work still in progress.
 * - The canvas is created in the container's own document and redrawn if its
 *   context is restored after being lost.
 *
 * The canvas goes in the tile pane, so features stay above it even though it is
 * added after them.
 */
import * as L from "leaflet";
import { isAnimatedImage, isCacheableSize, mayCacheImage } from "../core/imageCache";
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
  /** Remove the layer and free the canvas. Idempotent. */
  destroy(): void;
}

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
 * An image overlay whose element is the given canvas. Leaflet then places,
 * sizes and zoom-animates it exactly like an `<img>`. `_initImage` is private
 * Leaflet API (pinned at 1.9.4).
 */
function canvasOverlay(canvas: HTMLCanvasElement, bounds: Bounds): L.ImageOverlay {
  const CanvasOverlay = L.ImageOverlay.extend({
    _initImage(this: AdoptingOverlay): void {
      const el = (this._image = this._url);
      el.classList.add("leaflet-image-layer");
      if (this._zoomAnimated) el.classList.add("leaflet-zoom-animated");
    },
  }) as unknown as new (element: HTMLElement, bounds: Bounds, options: L.ImageOverlayOptions) => L.ImageOverlay;
  return new CanvasOverlay(canvas, bounds, { interactive: false, pane: "tilePane" });
}

export function addImageLayer(map: L.Map, container: HTMLElement, options: ImageLayerOptions): ImageLayerHandle {
  const { imageUrl, bounds, width, height, source } = options;
  let destroyed = false;
  let layer: L.Layer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  /** Only the newest preparation may draw. */
  let generation = 0;

  const release = (): void => {
    layer?.remove();
    layer = null;
    if (!canvas) return;
    canvas.removeEventListener("contextrestored", onRestored);
    // A zero-sized canvas gives its memory back without waiting for collection.
    canvas.width = 0;
    canvas.height = 0;
    canvas = null;
  };

  const showImage = (): void => {
    release();
    layer = L.imageOverlay(imageUrl, bounds, { interactive: false }).addTo(map);
  };

  /** Decode the bytes and draw them; false when this image should stay an `<img>`. */
  const draw = async (from: ImageSource, isCurrent: () => boolean): Promise<boolean> => {
    const bytes = await from.read();
    if (!isCurrent()) return true;
    if (isAnimatedImage(new Uint8Array(bytes))) return false;
    const doc = container.ownerDocument;
    const win = (doc.defaultView ?? globalThis) as DecodeWindow;
    // Decoding a Blob happens off the main thread.
    const type = MIME_TYPES[from.extension.toLowerCase()] ?? "";
    const bitmap = await win.createImageBitmap(new Blob([bytes], { type }));
    try {
      if (!isCurrent()) return true;
      // The map file's size can disagree with the image, so check the real one.
      if (!isCacheableSize(bitmap.width, bitmap.height)) return false;
      const target = canvas ?? doc.createElement("canvas");
      if (!canvas) {
        canvas = target;
        target.addEventListener("contextrestored", onRestored);
      }
      target.width = bitmap.width;
      target.height = bitmap.height;
      const context = target.getContext("2d");
      if (!context) return false;
      context.drawImage(bitmap, 0, 0);
      layer ??= canvasOverlay(target, bounds).addTo(map);
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
