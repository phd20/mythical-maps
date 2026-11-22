/**
 * The feature panel (bead 5.4, spec map-editing "Folder tree management"): an
 * in-view side panel listing every feature as a tree ordered by rank.
 *
 * - Selection syncs both ways: clicking a row calls `host.select`, and the view
 *   calls `setSelected` when the selection changes elsewhere (the map).
 * - The eye button toggles `isHidden`; folders can be created and renamed
 *   (double-click or the pencil); rows drag to reorder or move into a folder.
 * - Every change is an op passed to `host.edit` (the view's `edit()`, so the
 *   lock is enforced at the model layer). The panel never mutates the model
 *   and is re-rendered from the model on each `update`.
 * - All elements are created through the parent element, so they belong to its
 *   `ownerDocument` (pop-out windows).
 */
import { setIcon } from "obsidian";
import type { ApplyResult } from "../core/document";
import { dropZoneFor, newFolderParent, planDrop, treeRows, type DropZone, type TreeRow } from "../core/featureTree";
import type { FeatureType, MapDocument } from "../core/schema";
import type { EditOp } from "../obsidian/mapView";

export interface FeaturePanelHost {
  /** Apply an edit op; false-ok results are refused (lock, invalid). */
  edit(op: EditOp): ApplyResult;
  /** Select a feature; the view calls `setSelected` back. */
  select(id: string): void;
  /** Show a message to the user. */
  notify(message: string): void;
  /** Show the row's context menu (bead 5.6: Delete). */
  contextMenu?(id: string, event: MouseEvent): void;
}

export const PANEL_TITLE = "Features";
export const NEW_FOLDER_LABEL = "New folder";
export const NEW_FOLDER_NAME = "New folder";
export const EMPTY_TEXT = "No features yet";
export const HIDE_LABEL = "Hide";
export const SHOW_LABEL = "Show";
export const RENAME_LABEL = "Rename folder";

const TYPE_ICONS: Record<FeatureType, string> = {
  pin: "map-pin",
  label: "type",
  region: "hexagon",
  path: "route",
  folder: "folder",
};

const UNNAMED: Record<FeatureType, string> = {
  pin: "Untitled pin",
  label: "Untitled label",
  region: "Untitled region",
  path: "Untitled path",
  folder: "Untitled folder",
};

export class FeaturePanel {
  readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private map: MapDocument | null = null;
  private selectedId: string | null = null;
  private readonly collapsed = new Set<string>();
  private dragId: string | null = null;
  /** The folder whose name is being edited; the list is not rebuilt meanwhile. */
  private renamingId: string | null = null;
  private pendingRender = false;
  /** Row elements by feature id, as last rendered. */
  private readonly rows = new Map<string, HTMLElement>();
  /** Elements carrying drag markers, cleared when the drag ends. */
  private readonly marked = new Set<HTMLElement>();
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    private readonly host: FeaturePanelHost,
  ) {
    this.el = parent.createDiv({ cls: "mythical-map-panel" });
    const header = this.el.createDiv({ cls: "mythical-map-panel-header" });
    header.createSpan({ cls: "mythical-map-panel-title", text: PANEL_TITLE });
    const add = header.createEl("button", { cls: "mythical-map-panel-button clickable-icon" });
    add.setAttribute("aria-label", NEW_FOLDER_LABEL);
    setIcon(add, "folder-plus");
    add.addEventListener("click", () => this.createFolder());
    this.listEl = this.el.createDiv({ cls: "mythical-map-panel-list" });
    // Dropping on the empty area below the rows moves the feature to the end of the root.
    this.listEl.addEventListener("dragover", (evt) => {
      if (this.dragId === null || (evt as Event).target !== this.listEl) return;
      (evt as Event).preventDefault();
    });
    this.listEl.addEventListener("drop", (evt) => {
      if ((evt as Event).target !== this.listEl) return;
      (evt as Event).preventDefault();
      this.dropToRootEnd();
    });
  }

  /** Re-render from the model. */
  update(map: MapDocument): void {
    this.map = map;
    this.render();
  }

  /** The selection changed (in the map or here). */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.el.remove();
  }

  // --- rendering ---

  private render(): void {
    if (this.destroyed || !this.map) return;
    if (this.renamingId !== null) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    const rows = treeRows(this.map, this.collapsed);
    this.listEl.empty();
    this.rows.clear();
    this.marked.clear();
    if (rows.length === 0) {
      this.listEl.createDiv({ cls: "mythical-map-panel-empty", text: EMPTY_TEXT });
      return;
    }
    for (const row of rows) this.renderRow(row);
  }

  private renderRow(row: TreeRow): void {
    const { feature } = row;
    const isFolder = feature.type === "folder";
    const cls = ["mythical-map-panel-row"];
    if (feature.id === this.selectedId) cls.push("is-selected");
    if (feature.isHidden === true) cls.push("is-hidden");
    else if (row.effectivelyHidden) cls.push("is-ancestor-hidden");
    const rowEl = this.listEl.createDiv({ cls });
    this.rows.set(feature.id, rowEl);
    rowEl.setAttribute("data-feature-id", feature.id);
    rowEl.setAttribute("style", `--mythical-depth: ${row.depth}`);
    rowEl.setAttribute("draggable", "true");

    const chevron = rowEl.createSpan({ cls: "mythical-map-panel-chevron" });
    if (isFolder && row.hasChildren) {
      setIcon(chevron, row.collapsed ? "chevron-right" : "chevron-down");
      chevron.addEventListener("click", (evt) => {
        (evt as Event).stopPropagation?.();
        this.toggleCollapsed(feature.id);
      });
    }
    const icon = rowEl.createSpan({ cls: "mythical-map-panel-icon" });
    setIcon(icon, TYPE_ICONS[feature.type]);
    rowEl.createSpan({
      cls: ["mythical-map-panel-name", ...(feature.name ? [] : ["is-unnamed"])],
      text: feature.name ?? UNNAMED[feature.type],
    });

    if (isFolder) {
      const rename = rowEl.createEl("button", { cls: "mythical-map-panel-button clickable-icon" });
      rename.setAttribute("aria-label", RENAME_LABEL);
      setIcon(rename, "pencil");
      rename.addEventListener("click", (evt) => {
        (evt as Event).stopPropagation?.();
        this.beginRename(feature.id);
      });
    }
    const hidden = feature.isHidden === true;
    const eye = rowEl.createEl("button", { cls: "mythical-map-panel-button mythical-map-panel-eye clickable-icon" });
    eye.setAttribute("aria-label", hidden ? SHOW_LABEL : HIDE_LABEL);
    setIcon(eye, hidden ? "eye-off" : "eye");
    eye.addEventListener("click", (evt) => {
      (evt as Event).stopPropagation?.();
      this.toggleHidden(feature.id, hidden);
    });

    rowEl.addEventListener("click", () => this.select(feature.id));
    rowEl.addEventListener("contextmenu", (evt) => {
      if (!this.host.contextMenu) return;
      (evt as Event).preventDefault();
      this.host.contextMenu(feature.id, evt as MouseEvent);
    });
    if (isFolder) {
      rowEl.addEventListener("dblclick", () => this.beginRename(feature.id));
    }
    this.wireDrag(rowEl, feature.id, isFolder);
  }

  // --- actions ---

  private select(id: string): void {
    this.setSelected(id);
    this.host.select(id);
  }

  private toggleCollapsed(id: string): void {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.render();
  }

  private toggleHidden(id: string, currentlyHidden: boolean): void {
    // Un-hiding removes the key so the file stays canonical.
    this.host.edit({ type: "update", id, patch: { isHidden: currentlyHidden ? undefined : true } });
  }

  /** Create a folder in the selected folder (else the root), last among its siblings, and start renaming it. */
  createFolder(): void {
    if (!this.map) return;
    const parentId = newFolderParent(this.map, this.selectedId);
    const result = this.host.edit({
      type: "insert",
      feature: { type: "folder", name: NEW_FOLDER_NAME },
      placement: { parentId },
    });
    if (!result.ok || !result.id) return;
    if (parentId !== null) this.collapsed.delete(parentId);
    this.select(result.id);
    this.beginRename(result.id);
  }

  /** Replace the folder's name with a text field; Enter or blur commits, Escape cancels. */
  beginRename(id: string): void {
    if (this.destroyed || this.renamingId !== null) return;
    const rowEl = this.rows.get(id);
    const folder = this.map?.features.find((f) => f.id === id);
    if (!rowEl || !folder || folder.type !== "folder") return;
    this.renamingId = id;
    rowEl.addClass("is-renaming"); // hides the name text while the field is shown
    const input = rowEl.createEl("input", { cls: "mythical-map-panel-rename" });
    input.type = "text";
    input.value = folder.name ?? "";
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      this.renamingId = null;
      if (commit) this.commitRename(id, input.value);
      if (this.pendingRender || !commit) this.render();
    };
    input.addEventListener("keydown", (evt) => {
      const key = (evt as KeyboardEvent).key;
      (evt as Event).stopPropagation();
      if (key === "Enter") finish(true);
      else if (key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (evt) => (evt as Event).stopPropagation());
    input.addEventListener("dblclick", (evt) => (evt as Event).stopPropagation());
    input.focus();
    input.select();
  }

  private commitRename(id: string, value: string): void {
    const name = value.trim();
    const current = this.map?.features.find((f) => f.id === id)?.name ?? "";
    if (name === current) return;
    this.host.edit({ type: "update", id, patch: { name: name === "" ? undefined : name } });
  }

  // --- drag and drop ---

  private wireDrag(rowEl: HTMLElement, id: string, isFolder: boolean): void {
    rowEl.addEventListener("dragstart", (evt) => {
      if (this.renamingId !== null) return;
      this.dragId = id;
      const dt = (evt as DragEvent).dataTransfer;
      if (dt) {
        dt.effectAllowed = "move";
        dt.setData("text/plain", id);
      }
      rowEl.addClass("is-dragging");
    });
    rowEl.addEventListener("dragend", () => {
      this.dragId = null;
      this.clearDropMarks();
      rowEl.removeClass("is-dragging");
    });
    rowEl.addEventListener("dragover", (evt) => {
      const zone = this.zoneAt(evt as DragEvent, rowEl, isFolder);
      const plan = this.dragId !== null && this.map ? planDrop(this.map, this.dragId, id, zone) : null;
      this.clearDropMarks();
      if (!plan?.ok) {
        // A refused drop shows no marker and no drop cursor: nothing happens on release.
        if (plan) this.mark(rowEl, "is-drop-refused");
        return;
      }
      (evt as Event).preventDefault();
      this.mark(rowEl, `is-drop-${zone}`);
    });
    rowEl.addEventListener("dragleave", () => this.clearDropMarks());
    rowEl.addEventListener("drop", (evt) => {
      (evt as Event).preventDefault();
      const zone = this.zoneAt(evt as DragEvent, rowEl, isFolder);
      const dragId = this.dragId;
      this.dragId = null;
      this.clearDropMarks();
      if (dragId !== null) this.drop(dragId, id, zone);
    });
  }

  private zoneAt(evt: DragEvent, rowEl: HTMLElement, isFolder: boolean): DropZone {
    const rect = rowEl.getBoundingClientRect();
    const ratio = rect.height > 0 ? (evt.clientY - rect.top) / rect.height : 0.5;
    return dropZoneFor(ratio, isFolder);
  }

  private mark(el: HTMLElement, cls: string): void {
    el.addClass(cls);
    this.marked.add(el);
  }

  private clearDropMarks(): void {
    for (const el of this.marked) el.removeClass("is-drop-before", "is-drop-after", "is-drop-inside", "is-drop-refused");
    this.marked.clear();
  }

  /** Apply a drop. Refused plans (cycles, non-folder targets) change nothing and say why. */
  drop(dragId: string, targetId: string, zone: DropZone): boolean {
    if (!this.map) return false;
    const plan = planDrop(this.map, dragId, targetId, zone);
    if (!plan.ok) {
      this.host.notify(plan.error);
      return false;
    }
    const result = this.host.edit({ type: "move", id: plan.id, placement: plan.placement });
    if (result.ok && zone === "inside") this.collapsed.delete(targetId);
    return result.ok;
  }

  private dropToRootEnd(): void {
    const dragId = this.dragId;
    this.dragId = null;
    this.clearDropMarks();
    if (dragId === null) return;
    this.host.edit({ type: "move", id: dragId, placement: { parentId: null } });
  }
}
