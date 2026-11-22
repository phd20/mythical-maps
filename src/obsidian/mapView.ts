/**
 * `TextFileView` for `.map` files (design D4, spec map-view "Map files open in
 * a map view" and map-file "Invalid files are never overwritten").
 *
 * The view keeps the last parse in memory. A valid map renders as a Leaflet
 * base map (the image on the frame bounds, see `ui/baseMap.ts`) with a small
 * status line; any parse failure renders an error state, and from an error
 * state nothing is ever written: `getViewData()` hands back the raw text
 * unchanged, and `save()` / `requestSave()` return early.
 *
 * The Leaflet map is torn down on every re-render, on `clear()` and on unload.
 *
 * Bead 4.2: the map opens at its saved `viewport` (or fits the image), "Set
 * current view as default" saves the live centre and zoom as `viewport`, and a
 * missing image shows an "Image not found" notice whose "Choose image…" picks
 * a vault image and updates `image`. Both edits go through a `MapStore` op
 * (`setViewport` / `setImage`, so the store's lock applies), then
 * `requestSave()`.
 *
 * Bead 4.3: features are drawn by the base map's renderer, once after mount and
 * again on every store change (layers are reused by id). Bead 5.1 takes over the store wiring (undo, lock toggle).
 */
import { Notice, TextFileView, type Menu, type TFile, type WorkspaceLeaf } from "obsidian";
import { MapStore, type Op } from "../core/document";
import { parseMap, type ParseResult } from "../core/parse";
import { FEATURE_TYPES, type FeatureType, type MapDocument } from "../core/schema";
import { stringifyMap } from "../core/serialize";
import { mountBaseMap, type BaseMapHandle, type MountBaseMap } from "../ui/baseMap";
import { obsidianIcons } from "../ui/obsidianIcons";
import { VIEW_TYPE_MAP } from "./constants";
import { ImageSuggestModal, vaultImageFiles } from "./imageSuggestModal";
import { readImageSizeFromVault, type ImageSize } from "./newMapCommand";

export const SET_DEFAULT_VIEW_COMMAND_ID = "set-current-view-as-default";
export const SET_DEFAULT_VIEW_COMMAND_NAME = "Set current view as default";
export const CHOOSE_IMAGE_TEXT = "Choose image…";

export type ParseFailure = Extract<ParseResult, { ok: false }>;

export type MapViewState =
  | { kind: "empty" }
  | { kind: "ok"; map: MapDocument }
  | { kind: "error"; failure: ParseFailure; raw: string };

const ERROR_TEXT: Record<ParseFailure["kind"], { heading: string; detail: string }> = {
  json: {
    heading: "This map file isn't valid JSON",
    detail: "Fix the JSON below and the map will reload. The file has not been changed.",
  },
  "not-mythical": {
    heading: "Not a Mythical map",
    detail: 'This file is JSON but has no "type": "mythical-map" marker, so it was left untouched.',
  },
  "future-version": {
    heading: "Made with a newer Mythical Maps",
    detail: "Upgrade the Mythical Maps plugin to open this map. The file has not been changed.",
  },
  invalid: {
    heading: "This map has errors",
    detail: "Fix the issues below and the map will reload. The file has not been changed.",
  },
};

const PLURALS: Record<FeatureType, [string, string]> = {
  pin: ["pin", "pins"],
  label: ["label", "labels"],
  region: ["region", "regions"],
  path: ["path", "paths"],
  folder: ["folder", "folders"],
};

/** Feature counts per type, e.g. "3 pins · 1 label · 1 region · 1 path · 2 folders". Zero counts are omitted. */
export function featureSummary(map: MapDocument): string {
  const counts = new Map<FeatureType, number>();
  for (const f of map.features) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const parts = FEATURE_TYPES.filter((t) => counts.has(t)).map((t) => {
    const n = counts.get(t) ?? 0;
    const [one, many] = PLURALS[t];
    return `${n} ${n === 1 ? one : many}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "No features";
}

export class MapView extends TextFileView {
  private viewState: MapViewState = { kind: "empty" };
  private baseMap: BaseMapHandle | null = null;
  /** Applies edit ops to the ok-state map; null in any other state. */
  private store: MapStore | null = null;
  /** Unsubscribes the re-render listener from the current store. */
  private unsubscribe: (() => void) | null = null;

  /** Creates the Leaflet base map. Replaceable so tests can run without a DOM. */
  mountMap: MountBaseMap = mountBaseMap;
  /** Lets the user pick a vault image; calls `onChoose` only if one is chosen. Replaceable for tests. */
  pickImage = (onChoose: (file: TFile) => void): void => {
    new ImageSuggestModal(this.app, vaultImageFiles(this.app), onChoose).open();
  };
  /** Natural pixel size of an image file. Replaceable for tests. */
  readImageSize = (file: TFile): Promise<ImageSize> => readImageSizeFromVault(this.app, file);
  /** Shows a message to the user. Replaceable for tests. */
  notify = (message: string): void => {
    new Notice(message);
  };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // `requestSave` is the base class's debounced function property: wrap it so
    // an error state can never schedule a write.
    const baseRequestSave = this.requestSave;
    this.requestSave = () => {
      if (this.viewState.kind !== "ok") return;
      baseRequestSave();
    };
  }

  /** The mounted Leaflet base map, if the view currently shows one. */
  get mapHandle(): BaseMapHandle | null {
    return this.baseMap;
  }

  /** Current parse state (read-only; for tests and later beads). */
  get mapState(): MapViewState {
    return this.viewState;
  }

  override getViewType(): string {
    return VIEW_TYPE_MAP;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Map";
  }

  override getIcon(): string {
    return "map";
  }

  override getViewData(): string {
    switch (this.viewState.kind) {
      case "ok":
        return stringifyMap(this.viewState.map);
      case "error":
        return this.viewState.raw;
      case "empty":
        return this.data;
    }
  }

  override setViewData(data: string, _clear: boolean): void {
    const result = parseMap(data);
    this.viewState = result.ok ? { kind: "ok", map: result.map } : { kind: "error", failure: result, raw: data };
    this.setStore(result.ok ? new MapStore(result.map) : null);
    this.render();
  }

  override clear(): void {
    this.destroyMap();
    this.viewState = { kind: "empty" };
    this.setStore(null);
    this.contentEl.empty();
  }

  override onunload(): void {
    this.destroyMap();
    this.setStore(null);
    super.onunload();
  }

  /** Obsidian calls this when the pane changes size (split drag, sidebar toggle). */
  override onResize(): void {
    this.baseMap?.refresh();
  }

  /** Never write from an error (or empty) state: the file must stay untouched. */
  override async save(clear?: boolean): Promise<void> {
    if (this.viewState.kind !== "ok") return;
    await super.save(clear);
  }

  /** True when the view shows a map whose live view can be saved as `viewport`. */
  canSetDefaultView(): boolean {
    return this.viewState.kind === "ok" && this.baseMap?.currentViewport() != null;
  }

  /** Save the live centre and zoom as the map's `viewport`. Returns false if nothing was saved. */
  setCurrentViewAsDefault(): boolean {
    const viewport = this.viewState.kind === "ok" ? this.baseMap?.currentViewport() : null;
    if (!viewport) return false;
    if (!this.applyOp({ type: "setViewport", viewport })) return false;
    this.notify("Saved the current view as this map's default.");
    return true;
  }

  /** Open the image picker; the chosen image replaces `image` (path and pixel size). */
  chooseImage(): void {
    if (this.viewState.kind !== "ok") return;
    this.pickImage((file) => {
      void this.replaceImage(file);
    });
  }

  /** Point the map at `file`: read its pixel size, apply `setImage`, save and re-render. Never throws. */
  async replaceImage(file: TFile): Promise<boolean> {
    const store = this.store;
    if (!store) return false;
    let size: ImageSize;
    try {
      size = await this.readImageSize(file);
    } catch (err) {
      console.error("Mythical Maps: could not read image size", file.path, err);
      this.notify(`Could not read the size of ${file.path}.`);
      return false;
    }
    const width = Math.round(size.width);
    const height = Math.round(size.height);
    if (!(width > 0 && height > 0)) {
      this.notify(`Could not read the size of ${file.path}.`);
      return false;
    }
    // The file may have been reloaded (or turned invalid) while the image loaded.
    if (this.store !== store) return false;
    if (!this.applyOp({ type: "setImage", image: { path: file.path, width, height } })) return false;
    this.render();
    return true;
  }

  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (!this.canSetDefaultView()) return;
    menu.addItem((item) =>
      item
        .setTitle(SET_DEFAULT_VIEW_COMMAND_NAME)
        .setIcon("locate-fixed")
        .onClick(() => {
          this.setCurrentViewAsDefault();
        }),
    );
  }

  /** Apply an edit through the store (which enforces the lock), then schedule a save. Only in the ok state. */
  private applyOp(op: Exclude<Op, { type: "replace" }>): boolean {
    const store = this.store;
    if (this.viewState.kind !== "ok" || !store) return false;
    const result = store.apply(op);
    if (!result.ok) {
      this.notify(result.error);
      return false;
    }
    this.viewState = { kind: "ok", map: store.map };
    this.requestSave();
    return true;
  }

  /** Swap the store, moving the re-render subscription to the new one. */
  private setStore(store: MapStore | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.store = store;
    if (store) this.unsubscribe = store.subscribe((map) => this.baseMap?.render(map));
  }

  private destroyMap(): void {
    this.baseMap?.destroy();
    this.baseMap = null;
  }

  private render(): void {
    this.destroyMap();
    const el = this.contentEl;
    el.empty();
    el.addClass("mythical-map-view");
    const state = this.viewState;
    if (state.kind === "ok") this.renderMap(el, state.map);
    else if (state.kind === "error") this.renderError(el, state.failure);
  }

  /** Vault resource URL of the map image, or null when the file is missing. */
  private imageUrl(map: MapDocument): string | null {
    const file = this.app.vault.getFileByPath(map.image.path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  private renderMap(el: HTMLElement, map: MapDocument): void {
    const imageUrl = this.imageUrl(map);
    const { width, height } = map.image;
    // A missing image still mounts the map (no overlay), so features keep their frame.
    this.baseMap = this.mountMap(el, {
      imageUrl,
      width,
      height,
      icons: obsidianIcons,
      ...(map.viewport ? { viewport: map.viewport } : {}),
    });
    this.baseMap.render(map);
    if (!imageUrl) this.renderMissingImage(el, map.image.path);
    const status = el.createDiv({ cls: "mythical-map-status" });
    status.createSpan({ cls: "mythical-map-image", text: `${map.image.path} (${map.image.width} × ${map.image.height})` });
    status.createSpan({ text: " · " });
    status.createSpan({ cls: "mythical-map-counts", text: featureSummary(map) });
  }

  private renderMissingImage(el: HTMLElement, path: string): void {
    const notice = el.createDiv({ cls: "mythical-map-missing-image" });
    notice.createEl("p", { text: `Image not found: ${path}` });
    const button = notice.createEl("button", { cls: "mod-cta", text: CHOOSE_IMAGE_TEXT });
    button.addEventListener("click", () => this.chooseImage());
  }

  private renderError(el: HTMLElement, failure: ParseFailure): void {
    const { heading, detail } = ERROR_TEXT[failure.kind];
    const box = el.createDiv({ cls: ["mythical-map-error", `mythical-map-error-${failure.kind}`] });
    box.createEl("h3", { text: heading });
    box.createEl("p", { text: detail });
    const list = box.createEl("ul", { cls: "mythical-map-issues" });
    for (const issue of failure.issues) {
      list.createEl("li", { text: issue.path ? `${issue.path}: ${issue.message}` : issue.message });
    }
  }
}
