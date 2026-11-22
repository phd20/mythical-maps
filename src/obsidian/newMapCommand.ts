/**
 * "New map from image" command and file-menu item (spec map-file "New map
 * from image"). Reads the image's pixel size, creates `<basename>.map` next to
 * the image (with a numeric suffix when the name is taken) and opens it.
 *
 * The document and the file name come from the pure `core/newMap.ts`; this
 * module only wires them to Obsidian through `NewMapDeps`, so tests can run
 * without a DOM.
 */
import { Notice, TFile, type App, type Plugin } from "obsidian";
import { newMapDocument, newMapPath } from "../core/newMap";
import { stringifyMap } from "../core/serialize";
import { MAP_EXTENSION } from "./constants";

export const NEW_MAP_COMMAND_ID = "new-map-from-image";
export const NEW_MAP_COMMAND_NAME = "New map from image";

/** Image extensions (lower case) offered "New map from image": the raster formats Obsidian embeds, plus SVG. */
export const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "svg"];

export function isImageFile(file: unknown): file is TFile {
  return file instanceof TFile && IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface NewMapDeps {
  /** True when a file or folder already exists at `path`. */
  exists(path: string): boolean;
  /** Natural pixel size of the image. Rejects when the image can't be loaded. */
  readImageSize(file: TFile): Promise<ImageSize>;
  create(path: string, data: string): Promise<TFile>;
  open(file: TFile): Promise<void>;
  notify(message: string): void;
}

/**
 * Create and open a new map for `image`. Returns the new file, or null after
 * telling the user why it failed. Never throws.
 */
export async function createMapFromImage(image: TFile, deps: NewMapDeps): Promise<TFile | null> {
  let size: ImageSize;
  try {
    size = await deps.readImageSize(image);
  } catch (err) {
    console.error("Mythical Maps: could not read image size", image.path, err);
    deps.notify(`Could not read the size of ${image.path}.`);
    return null;
  }
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (!(width > 0 && height > 0)) {
    deps.notify(`Could not read the size of ${image.path}.`);
    return null;
  }
  const path = newMapPath(image.path, (p) => deps.exists(p), MAP_EXTENSION);
  let file: TFile;
  try {
    file = await deps.create(path, stringifyMap(newMapDocument({ path: image.path, width, height })));
  } catch (err) {
    console.error("Mythical Maps: could not create map", path, err);
    deps.notify(`Could not create ${path}.`);
    return null;
  }
  try {
    await deps.open(file);
  } catch (err) {
    console.error("Mythical Maps: could not open map", path, err);
  }
  return file;
}

/** Load the image from its resource URL in the active window's document and read its natural size. */
export function readImageSizeFromVault(app: App, file: TFile): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    const img = activeDocument.createElement("img");
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error(`Failed to load ${file.path}`));
    img.src = app.vault.getResourcePath(file);
  });
}

export function createObsidianNewMapDeps(app: App): NewMapDeps {
  return {
    exists: (path) => app.vault.getAbstractFileByPath(path) !== null,
    readImageSize: (file) => readImageSizeFromVault(app, file),
    create: (path, data) => app.vault.create(path, data),
    open: (file) => app.workspace.getLeaf(false).openFile(file),
    notify: (message) => {
      new Notice(message);
    },
  };
}

/** Register the command (when the active file is an image) and the file-menu item on images. */
export function registerNewMapFromImage(plugin: Plugin, app: App, deps: NewMapDeps = createObsidianNewMapDeps(app)): void {
  plugin.addCommand({
    id: NEW_MAP_COMMAND_ID,
    name: NEW_MAP_COMMAND_NAME,
    checkCallback: (checking) => {
      const file = app.workspace.getActiveFile();
      if (!isImageFile(file)) return false;
      if (!checking) void createMapFromImage(file, deps);
      return true;
    },
  });
  plugin.registerEvent(
    app.workspace.on("file-menu", (menu, file) => {
      if (!isImageFile(file)) return;
      menu.addItem((item) =>
        item
          .setTitle(NEW_MAP_COMMAND_NAME)
          .setIcon("map")
          .onClick(() => {
            void createMapFromImage(file, deps);
          }),
      );
    }),
  );
}
