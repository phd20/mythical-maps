/**
 * "Find broken pins" command (bead 6.7, spec note-links "Find broken pins
 * command"). Scans every map in the vault map index with the link resolver
 * (`scanBrokenPins`) and lists the broken pins in a modal, grouped by map.
 * "Open map" opens the map centred on (and selecting) the pin; "Relink…"
 * picks a note and sets the pin's `link`: through the open view's `edit()`
 * when the map is open, otherwise through `vault.process` with canonical text
 * (a file that fails to parse is left untouched). Nothing ever clears a link.
 */
import { Modal, Notice, type App, type Plugin } from "obsidian";
import { relinkInText, scanBrokenPins, type BrokenPinGroup, type BrokenPinSource } from "../core/brokenPins";
import type { LinkResolver } from "../core/links";
import { VIEW_TYPE_MAP } from "./constants";
import { LinkSuggestModal } from "./linkSuggestModal";
import { MapView } from "./mapView";
import type { VaultMapIndex } from "./vaultMapIndex";

export const FIND_BROKEN_PINS_COMMAND_ID = "find-broken-pins";
export const FIND_BROKEN_PINS_COMMAND_NAME = "Find broken pins";
export const NO_BROKEN_PINS_TEXT = "No broken pins";

/** The index as a scan source. */
export function indexSource(index: VaultMapIndex): BrokenPinSource {
  return {
    mapPaths: () => index.allMaps(),
    linkedPins: (mapPath) => (index.get(mapPath)?.links ?? []).map((l) => ({ featureId: l.featureId, link: l.link })),
  };
}

function appResolver(app: App): LinkResolver {
  return { resolve: (linktext, sourcePath) => app.metadataCache.getFirstLinkpathDest(linktext, sourcePath)?.path ?? null };
}

function openViewFor(app: App, mapPath: string): MapView | null {
  for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_MAP)) {
    if (leaf.view instanceof MapView && leaf.view.file?.path === mapPath) return leaf.view;
  }
  return null;
}

/** Open the map (reusing a leaf that already shows it) and centre on the pin. */
export async function openMapAtPin(app: App, mapPath: string, featureId: string): Promise<void> {
  const file = app.vault.getFileByPath(mapPath);
  if (!file) {
    new Notice(`${mapPath} no longer exists.`);
    return;
  }
  const existing = app.workspace.getLeavesOfType(VIEW_TYPE_MAP).find((l) => l.view instanceof MapView && l.view.file?.path === mapPath);
  const leaf = existing ?? app.workspace.getLeaf(false);
  if (existing) await app.workspace.revealLeaf(existing);
  else await leaf.openFile(file);
  if (leaf.view instanceof MapView) leaf.view.focusFeature(featureId);
}

/** Set a pin's link. True when it was saved or applied to the open view. */
export async function relinkPin(app: App, mapPath: string, featureId: string, linktext: string): Promise<boolean> {
  const view = openViewFor(app, mapPath);
  if (view) return view.edit({ type: "update", id: featureId, patch: { link: linktext } }).ok;
  const file = app.vault.getFileByPath(mapPath);
  if (!file) return false;
  let changed = false;
  await app.vault.process(file, (text) => {
    const next = relinkInText(text, featureId, linktext);
    changed = next !== text;
    return next;
  });
  return changed;
}

export class BrokenPinsModal extends Modal {
  constructor(
    app: App,
    private groups: BrokenPinGroup[],
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("mythical-broken-pins-modal");
    this.titleEl.setText("Broken pins");
    this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    // `mythical-map-view` scopes the plugin's CSS (it only sets `position: relative`).
    el.addClass("mythical-map-view", "mythical-broken-pins");
    if (this.groups.length === 0) {
      el.createEl("p", { cls: "mythical-broken-pins-empty", text: NO_BROKEN_PINS_TEXT });
      return;
    }
    for (const group of this.groups) {
      const section = el.createDiv({ cls: "mythical-broken-pins-group" });
      section.createEl("h4", { cls: "mythical-broken-pins-map", text: group.mapPath });
      for (const pin of group.pins) {
        const row = section.createDiv({ cls: "mythical-broken-pins-row" });
        row.createSpan({ cls: "mythical-broken-pins-link", text: pin.link });
        const open = row.createEl("button", { text: "Open map" });
        open.addEventListener("click", () => {
          this.close();
          void openMapAtPin(this.app, group.mapPath, pin.featureId);
        });
        const relink = row.createEl("button", { text: "Relink…" });
        relink.addEventListener("click", () => {
          new LinkSuggestModal(this.app, group.mapPath, false, (linktext) => {
            if (linktext === null) return;
            void relinkPin(this.app, group.mapPath, pin.featureId, linktext).then((ok) => {
              if (!ok) return;
              this.drop(group.mapPath, pin.featureId);
            });
          }).open();
        });
      }
    }
  }

  /** Remove a relinked pin from the list. */
  private drop(mapPath: string, featureId: string): void {
    this.groups = this.groups
      .map((g) => (g.mapPath === mapPath ? { ...g, pins: g.pins.filter((p) => p.featureId !== featureId) } : g))
      .filter((g) => g.pins.length > 0);
    this.render();
  }
}

/** Scan with the current index (waiting for pending updates) and open the modal. */
export async function findBrokenPins(app: App, index: VaultMapIndex): Promise<void> {
  await index.whenIdle();
  new BrokenPinsModal(app, scanBrokenPins(indexSource(index), appResolver(app))).open();
}

export function registerFindBrokenPins(plugin: Plugin, app: App, index: () => VaultMapIndex): void {
  plugin.addCommand({
    id: FIND_BROKEN_PINS_COMMAND_ID,
    name: FIND_BROKEN_PINS_COMMAND_NAME,
    callback: () => {
      void findBrokenPins(app, index());
    },
  });
}
