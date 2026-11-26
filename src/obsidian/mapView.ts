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
 * The Leaflet map is torn down on every full re-render, on `clear()` and on
 * unload (a live reload re-renders in place, see bead 4.5 below).
 *
 * Bead 4.2: the map opens at its saved `viewport` (or fits the image), "Set
 * current view as default" saves the live centre and zoom as `viewport`, and a
 * missing image shows an "Image not found" notice whose "Choose image…" picks
 * a vault image and updates `image`. Both edits go through a `MapStore` op
 * (`setViewport` / `setImage`, so the store's lock applies), then
 * `requestSave()`.
 *
 * Bead 4.3: features are drawn by the base map's renderer, once after mount and
 * again on every store change (layers are reused by id).
 *
 * Bead 4.5, live reload: Obsidian calls `setViewData(data, false)` when the
 * open file changes on disk. Policy:
 * - an echo of our own save (data equal to `getViewData()`) is ignored;
 * - data that fails to parse switches to the error state (nothing is written);
 * - with no unsaved edits, the new map goes into the existing store as a
 *   `replace` op (history cleared, lock kept, not dirty) and the mounted base
 *   map re-renders in place, keeping pan and zoom. The base map is remounted
 *   only when the image (resolved URL, width or height) changed; with the same
 *   width and height the live centre and zoom carry over;
 * - with unsaved edits (store dirty), the local map is kept and a notice says
 *   the file changed on disk; the pending save then writes the local version
 *   (last write wins, design "Risks").
 * `save()` writes only when there are unsaved edits (opening and leaving a map
 * never rewrites it) and marks the store saved once the write finishes, if
 * nothing changed meanwhile.
 *
 * Bead 5.1, the store wired to the view (spec map-editing "Lock toggle",
 * "Saving", "Undo within a session"):
 * - Edits: every model edit goes through `edit(op)`, which applies the op to the
 *   `MapStore` and then calls `requestSave()`. A refused op (locked, or an
 *   invalid op) shows a notice, re-renders the model so a dragged layer snaps
 *   back, and returns the failed result. The store listener is the only place
 *   that brings the view in line with the model: it updates the state, then
 *   re-renders the features and status, or remounts the base map when the
 *   image changed.
 * - Lock: a header action toggles it. Lock state belongs to the view (default
 *   unlocked, never written to the file, design D10) and is carried into each
 *   new store. The store refuses every edit op, undo and redo while locked;
 *   that includes "Set current view as default" and "Choose image…", since
 *   both change the file. Pan, zoom, hover and links keep working.
 * - Undo/redo: Mod+Z and Mod+Shift+Z in the view's own `Scope`, so they only
 *   act while this map view is the active one, and never while a text field
 *   inside it has focus. Each undo or redo is saved. History is per store: a
 *   live reload (`replace`) or opening another file clears it.
 * - Flushing: `flush()` writes unsaved edits right away. It runs on
 *   `onUnloadFile` (file switched or tab closed), on `onClose`, on Obsidian's
 *   `quit` event and, synchronously, on unload. Nothing is written from an
 *   error or empty state, or when the store is clean.
 *
 * Bead 5.2, toolbar and creating features (spec map-editing "Create features"):
 * a toolbar over the map picks the mode (Select, Pin, Label, Region, Path; the
 * drawing modes are bead 5.3) and offers Fit. A click in Pin or Label mode
 * creates that feature at the click, Shift-click and the map context menu's
 * "Add pin here" create a pin in any mode. New features go in through `edit()`
 * as the last child of the selected folder (or the root, see `core/create.ts`)
 * and become selected. Selection lives in the view; a selection whose feature
 * is gone is dropped. While unlocked the view is in an edit mode: a click on a
 * feature selects it instead of opening its link.
 */
import {
  Menu,
  Notice,
  Scope,
  setIcon,
  TextFileView,
  type HoverPopover,
  type TFile,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import { createFeatureOp, createShapeOp, type CreatableKind, type DrawableKind, type LatLngLike } from "../core/create";
import { descendantCount, featureCenter } from "../core/features";
import { LOCKED_ERROR, MapStore, type ApplyResult, type Op } from "../core/document";
import { parseMap, type ParseResult } from "../core/parse";
import { linkPatch } from "../core/properties";
import { FEATURE_TYPES, type Feature, type FeatureType, type LatLng, type MapDocument, type Viewport } from "../core/schema";
import { stringifyMap } from "../core/serialize";
import { mountBaseMap, type BaseMapHandle, type MountBaseMap } from "../ui/baseMap";
import { FeaturePanel } from "../ui/featurePanel";
import { LinkSuggestModal } from "./linkSuggestModal";
import { PropertiesForm } from "../ui/propertiesForm";
import { obsidianIcons } from "../ui/obsidianIcons";
import type { RenderView } from "../ui/featureRenderer";
import { createToolbar, creationKindFor, EDIT_MODES, type EditMode, type ToolbarHandle } from "../ui/toolbar";
import { VIEW_TYPE_MAP } from "./constants";
import { confirmDelete } from "./deleteConfirmModal";
import { IconSuggest } from "./iconSuggest";
import { ImageSuggestModal, vaultImageFiles } from "./imageSuggestModal";
import { createLinkInteractions, linkOf, linkResolves } from "./linkActions";
import type { NoteMapsLookup } from "./noteMaps";
import { readImageSizeFromVault, type ImageSize } from "./newMapCommand";

export const SET_DEFAULT_VIEW_COMMAND_ID = "set-current-view-as-default";
export const SET_DEFAULT_VIEW_COMMAND_NAME = "Set current view as default";
export const CHOOSE_IMAGE_TEXT = "Choose image…";
export const UNDO_COMMAND_ID = "undo-map-edit";
export const REDO_COMMAND_ID = "redo-map-edit";
export const TOGGLE_LOCK_COMMAND_ID = "toggle-map-lock";
export const LOCKED_NOTICE ="This map is locked. Unlock it to edit.";
export const LOCK_TITLE = "Lock map";
export const UNLOCK_TITLE = "Unlock map";
export const ADD_PIN_HERE = "Add pin here";
export const DELETE_FEATURE = "Delete";
export const TOGGLE_PANEL_COMMAND_ID = "toggle-feature-panel";
export const TOGGLE_PANEL_COMMAND_NAME = "Show or hide the feature panel";
export const HIDE_PANEL_TITLE = "Hide feature panel";
export const SHOW_PANEL_TITLE = "Show feature panel";
/** Key of the hidden-panel flag in the view state kept with the workspace layout. */
export const PANEL_HIDDEN_STATE = "mythicalPanelHidden";

/** An op a user edit can apply; `replace` is reserved for reloading from disk. */
export type EditOp = Exclude<Op, { type: "replace" }>;

/** True when a key event comes from a text field, where Mod+Z must stay the field's own undo. */
export function isTextInputTarget(target: unknown): boolean {
  if (target === null || typeof target !== "object") return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

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
  /** Identifies the image the mounted base map shows (URL, width, height); a change needs a remount. */
  private mountedImageKey: string | null = null;
  /** The status line under the map, refreshed in place on reload. */
  private statusEl: HTMLElement | null = null;
  /** Per-view lock (never saved); applied to every store this view creates. */
  private locked = false;
  /** The active toolbar mode (bead 5.2); kept across re-renders, per view. */
  private mode: EditMode = "select";
  private toolbar: ToolbarHandle | null = null;
  private selected: string | null = null;
  private selectionListeners = new Set<(id: string | null) => void>();
  /** The header lock toggle, once the view is loaded. */
  private lockActionEl: HTMLElement | null = null;
  /** Whether the feature panel is hidden; per tab, kept in the view state, never in the file. */
  private panelHidden = false;
  /** The header panel toggle, once the view is loaded. */
  private panelActionEl: HTMLElement | null = null;

  /** Creates the Leaflet base map. Replaceable so tests can run without a DOM. */
  mountMap: MountBaseMap = mountBaseMap;
  /** Lets the user pick a vault image; calls `onChoose` only if one is chosen. Replaceable for tests. */
  pickImage = (onChoose: (file: TFile) => void): void => {
    new ImageSuggestModal(this.app, vaultImageFiles(this.app), onChoose).open();
  };
  /** Natural pixel size of an image file. Replaceable for tests. */
  readImageSize = (file: TFile): Promise<ImageSize> => readImageSizeFromVault(this.app, file);
  /** Asks before a folder with descendants is deleted (bead 5.6). Replaceable for tests. */
  confirmFolderDelete = (name: string, count: number): Promise<boolean> => confirmDelete(this.app, name, count);
  /** Context-menu events already handled by a feature menu, so the map menu skips them. */
  private featureMenuEvents = new WeakSet<object>();
  /** Shows a message to the user. Replaceable for tests. */
  notify = (message: string): void => {
    new Notice(message);
  };

  // --- Bead 6.2: hover preview and opening notes (see linkActions.ts) ---
  /** HoverParent: the page preview popover owned by this view. */
  hoverPopover: HoverPopover | null = null;
  /** True in edit modes (the view is unlocked), where a click selects instead of opening. */
  isEditing = (): boolean => !this.locked;
  /** Select a feature (bead 5.2); `selectedId` and `onSelectionChange` follow. */
  selectFeature = (featureId: string): void => this.setSelected(featureId);
  // --- end bead 6.2 ---

  // --- Bead 5.4: selection and the feature panel (see ui/featurePanel.ts) ---
  private panel: FeaturePanel | null = null;
  /** Bead 5.5: the properties form, shown inside the feature panel. */
  private propsForm: PropertiesForm | null = null;

  /** The selected feature's id, or null. Dropped automatically when the feature is deleted. */
  get selection(): string | null {
    return this.selected;
  }

  /** Set or clear the selection and bring the feature panel in line. */
  setSelection(featureId: string | null): void {
    this.setSelected(featureId);
  }
  // --- end bead 5.4 ---

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // `requestSave` is the base class's debounced function property: wrap it so
    // an error state can never schedule a write.
    const baseRequestSave = this.requestSave;
    this.requestSave = () => {
      if (this.viewState.kind !== "ok") return;
      baseRequestSave();
    };
    // View-scoped hotkeys: Obsidian activates this scope only while the view is active.
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", (evt) => this.handleHistoryKey(evt, "undo"));
    this.scope.register(["Mod", "Shift"], "z", (evt) => this.handleHistoryKey(evt, "redo"));
    // Bead 5.6: Delete (and Backspace, the Delete key on Mac keyboards) removes the selection.
    this.scope.register([], "Delete", (evt) => this.handleDeleteKey(evt));
    this.scope.register([], "Backspace", (evt) => this.handleDeleteKey(evt));
  }

  override onload(): void {
    super.onload();
    this.lockActionEl = this.addAction("lock-open", LOCK_TITLE, () => this.toggleLock());
    this.refreshLockUi();
    this.panelActionEl = this.addAction("panel-right", HIDE_PANEL_TITLE, () => this.togglePanel());
    this.refreshPanelUi();
    this.registerEvent(this.app.workspace.on("quit", (tasks) => tasks.add(() => this.flush())));
  }

  /** Bead 6.7: a pin to centre and select once the map is mounted ("Open map" in Find broken pins). */
  private pendingFocus: string | null = null;

  /** Bead 6.7: centre the map on a pin (keeping the zoom) and select it. Applied after load if the map is not mounted yet. */
  focusFeature(id: string): void {
    this.pendingFocus = id;
    this.applyPendingFocus();
  }

  private applyPendingFocus(): void {
    const id = this.pendingFocus;
    if (id === null || this.viewState.kind !== "ok" || !this.baseMap) return;
    this.pendingFocus = null;
    const feature = this.viewState.map.features.find((f) => f.id === id);
    if (feature?.type !== "pin") return;
    this.centerOnFeature(id);
    this.setSelected(id);
  }

  /** Pan to a feature at the current zoom; folders have nowhere to go. */
  private centerOnFeature(id: string): void {
    if (this.viewState.kind !== "ok") return;
    const feature = this.viewState.map.features.find((f) => f.id === id);
    const center = feature ? featureCenter(feature) : null;
    if (center) this.baseMap?.centerOn(center);
  }

  /** The mounted Leaflet base map, if the view currently shows one. */
  get mapHandle(): BaseMapHandle | null {
    return this.baseMap;
  }

  /** Current parse state (read-only; for tests and later beads). */
  get mapState(): MapViewState {
    return this.viewState;
  }

  /** The store behind an ok-state map, for reading and subscribing; edit through `edit()`. Null otherwise. */
  get mapStore(): MapStore | null {
    return this.store;
  }

  /** The current toolbar mode. */
  get editMode(): EditMode {
    return this.mode;
  }

  /** The selected feature id, or null. */
  get selectedId(): string | null {
    return this.selected;
  }

  /** Subscribe to selection changes; returns an unsubscribe function. */
  onSelectionChange(listener: (id: string | null) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /** Select a feature (or clear with null). Unknown ids clear the selection. */
  setSelected(id: string | null): void {
    const map = this.viewState.kind === "ok" ? this.viewState.map : null;
    const next = id !== null && map?.features.some((f) => f.id === id) ? id : null;
    if (next === this.selected) return;
    this.selected = next;
    this.panel?.setSelected(next);
    this.propsForm?.setSelected(next);
    if (this.statusEl && map) this.fillStatus(this.statusEl, map);
    for (const listener of [...this.selectionListeners]) listener(next);
  }

  setEditMode(mode: EditMode): void {
    this.mode = mode;
    this.toolbar?.setMode(mode);
    this.refreshModeUi();
    this.pushEditState();
  }

  /** Tell the map which mode and lock state apply, so it can turn drawing, dragging and reshaping on or off (bead 5.3). */
  private pushEditState(): void {
    // Optional call: some test doubles of the base map handle predate `setEditState`.
    this.baseMap?.setEditState?.({ mode: this.mode, locked: this.locked });
  }

  /** Create a region or path from drawn vertices in the selected folder and select it; too few vertices create nothing (bead 5.3). */
  private createShape(kind: DrawableKind, vertices: LatLngLike[]): void {
    if (this.viewState.kind !== "ok") return;
    const op = createShapeOp(this.viewState.map, kind, vertices, this.selected);
    if (!op) {
      this.notify(kind === "region" ? "A region needs at least 3 vertices." : "A path needs at least 2 vertices.");
      return;
    }
    const result = this.edit(op);
    if (result.ok && result.id !== undefined) this.setSelected(result.id);
  }

  /** Create a pin or label at `pos` in the selected folder and select it. Returns the new id, or null if refused. */
  createFeatureAt(kind: CreatableKind, pos: LatLng): string | null {
    if (this.viewState.kind !== "ok") return null;
    const result = this.edit(createFeatureOp(this.viewState.map, kind, pos, this.selected));
    if (!result.ok || result.id === undefined) return null;
    this.setSelected(result.id);
    return result.id;
  }

  private handleMapClick(pos: LatLng, event: MouseEvent): void {
    const kind = creationKindFor(this.mode, event.shiftKey);
    if (kind) this.createFeatureAt(kind, pos);
  }

  /**
   * Delete a feature and its subtree (bead 5.6). A folder with descendants asks
   * first; cancelling removes nothing. A locked map is refused with a notice
   * before any dialog. Resolves true when the feature was removed.
   */
  async deleteFeature(id: string): Promise<boolean> {
    const store = this.store;
    if (this.viewState.kind !== "ok" || !store) return false;
    if (store.isLocked) {
      this.notify(LOCKED_NOTICE);
      return false;
    }
    const feature = store.map.features.find((f) => f.id === id);
    if (!feature) return false;
    const count = descendantCount(store.map, id);
    if (count > 0) {
      const name = feature.name ?? "Untitled folder";
      if (!(await this.confirmFolderDelete(name, count))) return false;
      // The map may have been reloaded, swapped or locked while the dialog was open.
      if (this.store !== store) return false;
    }
    return this.edit({ type: "delete", id }).ok;
  }

  /** Scope handler: delete the selection unless a text field has focus or nothing is selected. */
  private handleDeleteKey(evt: KeyboardEvent): boolean {
    if (isTextInputTarget(evt.target) || this.selected === null || this.viewState.kind !== "ok") return true;
    void this.deleteFeature(this.selected);
    return false;
  }

  private addDeleteItem(menu: Menu, id: string): void {
    menu.addItem((item) =>
      item
        .setTitle(DELETE_FEATURE)
        .setIcon("trash")
        .onClick(() => {
          void this.deleteFeature(id);
        }),
    );
  }

  private handleMapContextMenu(pos: LatLng, event: MouseEvent): void {
    if (this.featureMenuEvents.has(event)) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle(ADD_PIN_HERE)
        .setIcon("map-pin")
        .onClick(() => {
          this.createFeatureAt("pin", pos);
        }),
    );
    menu.showAtMouseEvent(event);
  }

  private refreshModeUi(): void {
    for (const m of EDIT_MODES) this.contentEl.toggleClass(`mythical-map-mode-${m}`, m === this.mode);
  }

  /** Whether this view is locked (per view, not saved; default unlocked). */
  get isLocked(): boolean {
    return this.locked;
  }

  get canUndo(): boolean {
    return this.store?.canUndo ?? false;
  }

  get canRedo(): boolean {
    return this.store?.canRedo ?? false;
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

  override setViewData(data: string, clear: boolean): void {
    if (!clear && this.viewState.kind !== "empty" && data === this.getViewData()) return;
    const result = parseMap(data);
    if (!clear && result.ok && this.viewState.kind === "ok" && this.store && this.baseMap) {
      this.reload(this.store, result.map);
      return;
    }
    this.viewState = result.ok ? { kind: "ok", map: result.map } : { kind: "error", failure: result, raw: data };
    this.setStore(result.ok ? new MapStore(result.map) : null);
    this.render();
  }

  /** External change to an open map (see the file comment for the policy). */
  private reload(store: MapStore, map: MapDocument): void {
    if (store.dirty) {
      this.notify(`${this.file?.basename ?? "This map"} changed on disk, but it has unsaved edits here; keeping this version.`);
      return;
    }
    // The store listener re-renders in place, or remounts if the image changed.
    store.apply({ type: "replace", map });
  }

  override clear(): void {
    this.destroyMap();
    this.viewState = { kind: "empty" };
    this.pendingFocus = null;
    this.setSelected(null);
    this.setStore(null);
    this.contentEl.empty();
  }

  override onunload(): void {
    this.flushNow();
    this.destroyMap();
    this.setStore(null);
    this.lockActionEl = null;
    this.panelActionEl = null;
    super.onunload();
  }

  /** The file is being switched away from, or the tab closed: write unsaved edits first. */
  override async onUnloadFile(file: TFile): Promise<void> {
    await this.flush();
    await super.onUnloadFile(file);
  }

  override async onClose(): Promise<void> {
    await this.flush();
    await super.onClose();
  }

  /** Write unsaved edits now instead of waiting for the debounced save. No-op unless ok and dirty. */
  async flush(): Promise<void> {
    if (this.viewState.kind !== "ok" || !this.store?.dirty) return;
    await this.save();
  }

  /**
   * Last-chance flush for `onunload`, which cannot await: the canonical text
   * is taken now, before teardown, and the write is started.
   */
  private flushNow(): void {
    const store = this.store;
    const file = this.file;
    if (this.viewState.kind !== "ok" || !store?.dirty || !file) return;
    const data = this.getViewData();
    this.data = data;
    store.markSaved();
    this.app.vault.modify(file, data).catch((err: unknown) => {
      console.error("Mythical Maps: could not save on unload", file.path, err);
    });
  }

  /** Obsidian calls this when the pane changes size (split drag, sidebar toggle). */
  override onResize(): void {
    this.baseMap?.refresh();
  }

  /**
   * Never write from an error (or empty) state, or without unsaved edits: the
   * file must stay untouched, even when it is not in canonical form. Obsidian
   * calls `save(true)` when the file is unloaded, which also clears the view.
   */
  override async save(clear?: boolean): Promise<void> {
    if (this.viewState.kind !== "ok") return;
    const store = this.store;
    if (!store?.dirty) {
      if (clear) this.clear();
      return;
    }
    const saving = store.map;
    await super.save(clear);
    if (this.store === store && store.map === saving) store.markSaved();
  }

  /** True when the view shows a map whose live view can be saved as `viewport`. */
  canSetDefaultView(): boolean {
    return this.viewState.kind === "ok" && this.baseMap?.currentViewport() != null;
  }

  /** Save the live centre and zoom as the map's `viewport`. Returns false if nothing was saved. */
  setCurrentViewAsDefault(): boolean {
    const viewport = this.viewState.kind === "ok" ? this.baseMap?.currentViewport() : null;
    if (!viewport) return false;
    if (!this.edit({ type: "setViewport", viewport }).ok) return false;
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
    // The store listener remounts the base map on the new image.
    return this.edit({ type: "setImage", image: { path: file.path, width, height } }).ok;
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

  // --- Bead 7.1: frontmatter style overrides (see styleOverrides.ts) ---
  /** Builds the renderer's `RenderView` (style resolver) for a map path; set by the plugin. Null draws plugin defaults. */
  styleSource: ((mapPath: string) => RenderView) | null = null;

  /** The shown map and its path, or null outside the ok state. */
  styledMap(): { map: MapDocument; path: string } | null {
    const path = this.file?.path;
    return this.viewState.kind === "ok" && path ? { map: this.viewState.map, path } : null;
  }

  /** Re-render features with freshly resolved styles (a linked note or the settings changed). Never writes. */
  refreshStyles(): void {
    if (this.viewState.kind === "ok") this.baseMap?.render(this.viewState.map, this.renderView());
  }

  private renderView(): RenderView {
    const path = this.file?.path;
    const base: RenderView = this.styleSource && path ? this.styleSource(path) : {};
    const lookup = this.noteMaps;
    const withMaps: RenderView = lookup && path ? { ...base, hasMap: (f) => lookup.forPin(f, path).length > 0 } : base;
    // Bead 6.6: pins whose link does not resolve get the broken badge; the link itself is never touched.
    return path ? { ...withMaps, isBroken: (f) => this.isBrokenPin(f, path) } : withMaps;
  }

  /** Bead 6.6: a linked pin whose `link` does not resolve to a vault file. */
  private isBrokenPin(feature: Feature, path: string): boolean {
    const link = linkOf(feature);
    return link !== null && !linkResolves(this.app, link, path);
  }

  /** Bead 6.6: pick a note and set the pin's `link` through `edit()` (lock enforced). Never clears. */
  relinkPin(id: string): void {
    const file = this.file;
    if (!file) return;
    new LinkSuggestModal(this.app, file.path, false, (linktext) => {
      const pin = this.styledMap()?.map.features.find((f) => f.id === id);
      if (linktext !== null && pin) this.edit({ type: "update", id, patch: linkPatch(pin, linktext) });
    }).open();
  }

  /** Bead 6.3: which maps a pin's note lists (drill-down); set by the plugin. Null disables it. */
  noteMaps: NoteMapsLookup | null = null;
  // --- end bead 7.1 ---

  /**
   * The single entry point for model edits (toolbar, drags, panel, delete…).
   * Applies `op` through the store, which enforces the lock, then schedules a
   * save; the store listener re-renders. On refusal it shows a notice,
   * re-renders the unchanged model (so a dragged layer snaps back) and returns
   * the failed result. A successful insert's result carries the new `id`.
   */
  edit(op: EditOp): ApplyResult {
    const store = this.store;
    if (this.viewState.kind !== "ok" || !store) return { ok: false, error: "No map is open" };
    const result = store.apply(op);
    if (!result.ok) {
      this.notify(result.error === LOCKED_ERROR ? LOCKED_NOTICE : result.error);
      this.baseMap?.render(store.map, this.renderView());
      return result;
    }
    this.requestSave();
    return result;
  }

  /** Undo the last edit made in this view, then save. False when nothing changed (a notice if locked). */
  undo(): boolean {
    return this.stepHistory("undo");
  }

  /** Redo the last undone edit, then save. False when nothing changed (a notice if locked). */
  redo(): boolean {
    return this.stepHistory("redo");
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.store?.lock();
    else this.store?.unlock();
    this.refreshLockUi();
  }

  toggleLock(): void {
    this.setLocked(!this.locked);
  }

  /** Whether the feature panel (with the properties form) is hidden. */
  get isPanelHidden(): boolean {
    return this.panelHidden;
  }

  setPanelHidden(hidden: boolean): void {
    if (hidden === this.panelHidden) return;
    this.panelHidden = hidden;
    this.refreshPanelUi();
    this.app.workspace.requestSaveLayout();
  }

  togglePanel(): void {
    this.setPanelHidden(!this.panelHidden);
  }

  override getState(): Record<string, unknown> {
    return { ...super.getState(), [PANEL_HIDDEN_STATE]: this.panelHidden };
  }

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const hidden = (state as Record<string, unknown> | null)?.[PANEL_HIDDEN_STATE];
    // A state without the flag (opening another file in this tab) keeps the current choice.
    if (typeof hidden === "boolean") {
      this.panelHidden = hidden;
      this.refreshPanelUi();
    }
    await super.setState(state, result);
  }

  private refreshPanelUi(): void {
    this.contentEl.toggleClass("is-panel-hidden", this.panelHidden);
    const el = this.panelActionEl;
    if (!el) return;
    el.setAttribute("aria-label", this.panelHidden ? SHOW_PANEL_TITLE : HIDE_PANEL_TITLE);
    el.toggleClass("is-active", !this.panelHidden);
  }

  private stepHistory(direction: "undo" | "redo"): boolean {
    const store = this.store;
    if (this.viewState.kind !== "ok" || !store) return false;
    if (store.isLocked) {
      this.notify(LOCKED_NOTICE);
      return false;
    }
    const changed = direction === "undo" ? store.undo() : store.redo();
    if (changed) this.requestSave();
    return changed;
  }

  /** Scope handler: returns false (handled, default prevented) unless a text field has focus. */
  private handleHistoryKey(evt: KeyboardEvent, direction: "undo" | "redo"): boolean {
    if (isTextInputTarget(evt.target)) return true;
    if (direction === "undo") this.undo();
    else this.redo();
    return false;
  }

  private refreshLockUi(): void {
    this.contentEl.toggleClass("is-locked", this.locked);
    this.pushEditState();
    const el = this.lockActionEl;
    if (!el) return;
    setIcon(el, this.locked ? "lock" : "lock-open");
    el.setAttribute("aria-label", this.locked ? UNLOCK_TITLE : LOCK_TITLE);
    el.toggleClass("is-active", this.locked);
  }

  /** Swap the store, moving the re-render subscription to the new one and carrying the view's lock over. */
  private setStore(store: MapStore | null): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.store = store;
    if (!store) return;
    if (this.locked) store.lock();
    else store.unlock();
    this.unsubscribe = store.subscribe((map) => this.onStoreChange(map));
  }

  /**
   * Bring the view in line with the store after any change (edit, undo, redo,
   * reload). Re-renders features and status in place, keeping pan and zoom;
   * remounts the base map when the image changed, keeping the live view if the
   * frame size is the same.
   */
  private onStoreChange(map: MapDocument): void {
    const previous = this.viewState.kind === "ok" ? this.viewState.map : null;
    this.viewState = { kind: "ok", map };
    if (this.selected !== null && !map.features.some((f) => f.id === this.selected)) this.setSelected(null);
    const baseMap = this.baseMap;
    if (!baseMap) return;
    if (this.imageKey(map) !== this.mountedImageKey) {
      const live = baseMap.currentViewport();
      const sameFrame =
        previous !== null && previous.image.width === map.image.width && previous.image.height === map.image.height;
      this.render(sameFrame && live ? live : undefined);
      return;
    }
    baseMap.render(map, this.renderView());
    if (this.statusEl) this.fillStatus(this.statusEl, map);
    this.syncPanel(map);
  }

  /** Drop a selection whose feature is gone, then refresh the feature panel. */
  private syncPanel(map: MapDocument): void {
    if (this.selected !== null && !map.features.some((f) => f.id === this.selected)) this.setSelected(null);
    this.panel?.update(map);
    this.propsForm?.update(map);
  }

  private destroyMap(): void {
    this.propsForm?.destroy();
    this.propsForm = null;
    this.panel?.destroy();
    this.panel = null;
    this.baseMap?.destroy();
    this.baseMap = null;
    this.toolbar = null;
    this.mountedImageKey = null;
    this.statusEl = null;
  }

  /** Full re-render. `keepView` overrides the opening view (a remount during live reload). */
  private render(keepView?: Viewport): void {
    this.destroyMap();
    const el = this.contentEl;
    el.empty();
    el.addClass("mythical-map-view");
    const state = this.viewState;
    if (state.kind === "ok") this.renderMap(el, state.map, keepView);
    else if (state.kind === "error") this.renderError(el, state.failure);
  }

  private imageKey(map: MapDocument): string {
    return JSON.stringify([this.imageUrl(map), map.image.width, map.image.height]);
  }

  /** Vault resource URL of the map image, or null when the file is missing. */
  private imageUrl(map: MapDocument): string | null {
    const file = this.app.vault.getFileByPath(map.image.path);
    return file ? this.app.vault.getResourcePath(file) : null;
  }

  private renderMap(el: HTMLElement, map: MapDocument, keepView?: Viewport): void {
    const imageUrl = this.imageUrl(map);
    const { width, height } = map.image;
    const viewport = keepView ?? map.viewport;
    // A missing image still mounts the map (no overlay), so features keep their frame.
    this.baseMap = this.mountMap(el, {
      imageUrl,
      width,
      height,
      icons: obsidianIcons,
      interactions: createLinkInteractions({
        app: this.app,
        hoverParent: this,
        sourcePath: () => this.file?.path ?? null,
        isEditing: () => this.isEditing(),
        onSelect: (id) => this.selectFeature(id),
        notify: (message) => this.notify(message),
        extendMenu: (feature, menu, event) => {
          this.featureMenuEvents.add(event);
          this.addDeleteItem(menu, feature.id);
          return true;
        },
        relink: (feature) => this.relinkPin(feature.id),
        noteMaps: (feature) => {
          const path = this.file?.path;
          return this.noteMaps && path ? this.noteMaps.forPin(feature, path) : [];
        },
      }),
      pointer: {
        onClick: (pos, event) => this.handleMapClick(pos, event),
        onContextMenu: (pos, event) => this.handleMapContextMenu(pos, event),
      },
      geometry: {
        createShape: (kind, vertices) => this.createShape(kind, vertices),
        updateFeature: (id, patch) => {
          this.edit({ type: "update", id, patch });
        },
        // Invalid geometry (too few vertices): put the layer back to what the model says.
        rejected: () => {
          if (this.viewState.kind === "ok") this.baseMap?.render(this.viewState.map, this.renderView());
        },
      },
      ...(viewport ? { viewport } : {}),
    });
    this.toolbar = createToolbar(el, {
      mode: this.mode,
      icons: obsidianIcons,
      onMode: (mode) => this.setEditMode(mode),
      onFit: () => this.baseMap?.fit(),
    });
    this.refreshModeUi();
    this.pushEditState();
    this.mountedImageKey = this.imageKey(map);
    this.baseMap.render(map, this.renderView());
    if (!imageUrl) this.renderMissingImage(el, map.image.path);
    this.statusEl = el.createDiv({ cls: "mythical-map-status" });
    this.fillStatus(this.statusEl, map);
    this.refreshPanelUi();
    this.panel = new FeaturePanel(el, {
      hide: () => this.setPanelHidden(true),
      edit: (op) => this.edit(op),
      select: (id) => {
        this.selectFeature(id);
        this.centerOnFeature(id);
      },
      notify: (message) => this.notify(message),
      contextMenu: (id, event) => {
        const menu = new Menu();
        this.addDeleteItem(menu, id);
        menu.showAtMouseEvent(event);
      },
    });
    this.propsForm = new PropertiesForm(this.panel.el, {
      suggestIcons: (input, pick) => {
        const suggest = new IconSuggest(this.app, input, pick);
        return () => suggest.close();
      },
      edit: (op) => this.edit(op),
      chooseLink: (current, done) => {
        if (!this.file) return;
        new LinkSuggestModal(this.app, this.file.path, current.trim() !== "", done).open();
      },
    });
    this.panel.setSelected(this.selected);
    this.propsForm.setSelected(this.selected);
    this.syncPanel(map);
    this.applyPendingFocus();
  }

  private fillStatus(status: HTMLElement, map: MapDocument): void {
    status.empty();
    status.createSpan({ cls: "mythical-map-image", text: `${map.image.path} (${map.image.width} × ${map.image.height})` });
    status.createSpan({ text: " · " });
    status.createSpan({ cls: "mythical-map-counts", text: featureSummary(map) });
    const selected = this.selected === null ? undefined : map.features.find((f) => f.id === this.selected);
    if (selected) {
      status.createSpan({ text: " · " });
      status.createSpan({ cls: "mythical-map-selected", text: `Selected: ${selected.name ?? selected.type}` });
    }
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
