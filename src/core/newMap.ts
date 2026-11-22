/**
 * "New map from image" (spec map-file "New map from image"), pure parts:
 * the initial document for an image, and the path of the new `.map` file.
 */
import { boundsFor } from "./frame";
import { CURRENT_VERSION, MAP_TYPE, type MapDocument } from "./schema";

export interface NewMapImage {
  /** Vault path of the image, e.g. `Maps/westmarch.webp`. */
  path: string;
  /** Pixel size; must be positive integers. */
  width: number;
  height: number;
}

/**
 * A new map for `image`: no features, and a viewport centred on the image at
 * zoom 0. At zoom 0 the image's longer side is at most 256 screen pixels
 * (design D3), so the whole image fits any usable view; the view raises the
 * zoom to its own fit level (its `minZoom`) when the container is larger.
 */
export function newMapDocument(image: NewMapImage): MapDocument {
  const { path, width, height } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Image size must be positive integers, got ${width}x${height}`);
  }
  const [[south, west], [north, east]] = boundsFor(width, height);
  return {
    type: MAP_TYPE,
    version: CURRENT_VERSION,
    image: { path, width, height },
    viewport: { center: [(south + north) / 2, (west + east) / 2], zoom: 0 },
    features: [],
  };
}

/**
 * Path for a new map made from the image at `imagePath`: `<dir>/<basename>.map`
 * next to the image, or `<basename> 1.map`, `<basename> 2.map`, … when the
 * name is taken (`exists` returns true).
 */
export function newMapPath(imagePath: string, exists: (path: string) => boolean, extension = "map"): string {
  const slash = imagePath.lastIndexOf("/");
  const dir = slash >= 0 ? imagePath.slice(0, slash + 1) : "";
  const name = imagePath.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const basename = dot > 0 ? name.slice(0, dot) : name;
  const candidate = (n: number): string => `${dir}${basename}${n === 0 ? "" : ` ${n}`}.${extension}`;
  for (let n = 0; ; n++) {
    const path = candidate(n);
    if (!exists(path)) return path;
  }
}
