/**
 * Hover preview and opening notes from pins (bead 6.2, design D7/D8, spec
 * note-links "Hover preview and open note").
 *
 * - Hover: a linked pin whose link resolves triggers Obsidian's `hover-link`
 *   event, so the Page Preview core plugin shows the note. The source is
 *   registered once per plugin by `registerLinkHoverSource`.
 * - Click (view mode): opens the note with `workspace.openLinkText`, passing
 *   `Keymap.isModEvent(evt)` so Obsidian's modifier semantics apply (Mod →
 *   new tab, Mod+Alt → split, Mod+Alt+Shift → window).
 * - Click (edit modes, bead 5.2 decides when): selects the feature instead.
 * - A broken link (does not resolve) never creates a note: clicking shows a
 *   "Note not found" notice, and hovering shows no preview. The link itself is
 *   left untouched. Bead 6.6: hovering or right-clicking a broken pin offers
 *   "Relink…" (`ctx.relink`), and the renderer draws the broken badge.
 * - Features without a link do nothing in view mode.
 *
 * Drill-down (bead 6.3, spec note-links "Drill-down into a note's maps"): when
 * the linked note lists maps (`ctx.noteMaps`), hovering the pin shows a small
 * popup and right-clicking it shows a context menu, each with one
 * "Open map: <name>" action per resolving map. Choosing one opens that `.map`
 * file (`Keymap.isModEvent` decides a new tab or split).
 */
import { Keymap, Menu, type App, type HoverParent, type Plugin } from "obsidian";
import { splitLinktext } from "../core/links";
import type { Feature } from "../core/schema";
import type { FeatureInteractions } from "../ui/featureRenderer";
import { placePopup } from "../ui/popupPosition";
import type { NoteMap } from "../core/noteMaps";

/** Hover link source id, shown under Settings → Page preview. */
export const HOVER_SOURCE_ID = "mythical-maps";
export const HOVER_SOURCE_DISPLAY = "Mythical Maps";

/**
 * Register the map view as a `hover-link` source. `defaultMod: false`: the spec
 * scenario is a plain hover showing the preview; users can require Mod in the
 * Page preview settings.
 */
export function registerLinkHoverSource(plugin: Plugin): void {
  plugin.registerHoverLinkSource(HOVER_SOURCE_ID, { display: HOVER_SOURCE_DISPLAY, defaultMod: false });
}

export interface LinkActionContext {
  app: App;
  /** Owner of the hover popover (the map view). */
  hoverParent: HoverParent;
  /** Path of the `.map` file links resolve from; null when no file is open. */
  sourcePath(): string | null;
  /** True in edit modes, where a click selects instead of opening (bead 5.2). */
  isEditing(): boolean;
  /** Select a feature (edit modes). */
  onSelect(featureId: string): void;
  /** Show a message to the user. */
  notify(message: string): void;
  /** The maps listed by a pin's linked note (bead 6.3); omitted means no drill-down. */
  noteMaps?(feature: Feature): NoteMap[];
  /** Bead 6.6: pick a new note for a broken pin and save it ("Relink…"); omitted disables the action. */
  relink?(feature: Feature): void;
  /** Add more items to a feature's context menu (bead 5.6: Delete); true if any were added. */
  extendMenu?(feature: Feature, menu: Menu, event: MouseEvent): boolean;
}

/** Title of a drill-down action. */
export const openMapTitle = (map: NoteMap): string => `Open map: ${map.name}`;

/** Title of the relink action on a broken pin (bead 6.6). */
export const RELINK_TITLE = "Relink…";

/** Delay before the drill-down popup closes after the pointer leaves, in ms. */
export const POPUP_CLOSE_DELAY = 250;

/** The linktext of a linked pin, or null for every other feature. */
export function linkOf(feature: Feature): string | null {
  return feature.type === "pin" && typeof feature.link === "string" && feature.link !== "" ? feature.link : null;
}

/** Whether `link` resolves to a vault file from `sourcePath` (subpath ignored). */
export function linkResolves(app: App, link: string, sourcePath: string): boolean {
  const { path } = splitLinktext(link);
  if (path === "") return false; // same-file subpath; a map has no headings
  return app.metadataCache.getFirstLinkpathDest(path, sourcePath) !== null;
}

/** Feature hooks that preview and open pin links (see the file comment). */
export function createLinkInteractions(ctx: LinkActionContext): FeatureInteractions {
  const mapsOf = (feature: Feature): NoteMap[] => ctx.noteMaps?.(feature) ?? [];
  const openMap = (map: NoteMap, event: MouseEvent): void => {
    const sourcePath = ctx.sourcePath();
    if (sourcePath === null) return;
    void ctx.app.workspace.openLinkText(map.path, sourcePath, Keymap.isModEvent(event));
  };
  let popup: HTMLElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const closePopup = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    popup?.remove();
    popup = null;
  };
  const scheduleClose = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = setTimeout(closePopup, POPUP_CLOSE_DELAY);
  };
  const cancelClose = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
  };
  /** Whether a feature is a pin whose link does not resolve (bead 6.6). */
  const isBroken = (feature: Feature): boolean => {
    const link = linkOf(feature);
    const sourcePath = ctx.sourcePath();
    return link !== null && sourcePath !== null && !linkResolves(ctx.app, link, sourcePath);
  };
  /** A small popup beside the pin (clear of the page preview) listing "Open map: <name>" and "Relink…" buttons; closes when the pointer leaves it and the pin. */
  function showPopup(items: { title: string; run: (e: MouseEvent) => void }[], targetEl: HTMLElement): void {
    closePopup();
    const root = targetEl.closest<HTMLElement>(".mythical-map-view");
    if (!root) return;
    const doc = targetEl.ownerDocument;
    const box = doc.createElement("div");
    box.className = "mythical-map-drilldown-popup";
    for (const item of items) {
      const button = doc.createElement("button");
      button.className = "mythical-map-drilldown-item";
      button.textContent = item.title;
      button.addEventListener("click", (e) => {
        closePopup();
        item.run(e);
      });
      box.appendChild(button);
    }
    box.addEventListener("mouseenter", cancelClose);
    box.addEventListener("mouseleave", scheduleClose);
    targetEl.addEventListener("mouseleave", scheduleClose, { once: true });
    // Appended before placing, so its size can be measured.
    root.appendChild(box);
    popup = box;
    const host = root.getBoundingClientRect();
    const { left, top } = placePopup(
      targetEl.getBoundingClientRect(),
      host,
      { width: box.offsetWidth, height: box.offsetHeight },
      doc.defaultView?.innerHeight ?? host.bottom,
    );
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }
  return {
    onHover(feature, event, targetEl) {
      const maps = mapsOf(feature);
      const items = maps.map((map) => ({ title: openMapTitle(map), run: (e: MouseEvent) => openMap(map, e) }));
      if (ctx.relink && isBroken(feature)) items.push({ title: RELINK_TITLE, run: () => ctx.relink?.(feature) });
      if (items.length > 0 && targetEl) {
        cancelClose();
        showPopup(items, targetEl);
      }
      const link = linkOf(feature);
      const sourcePath = ctx.sourcePath();
      if (link === null || sourcePath === null || !linkResolves(ctx.app, link, sourcePath)) return;
      ctx.app.workspace.trigger("hover-link", {
        event,
        source: HOVER_SOURCE_ID,
        hoverParent: ctx.hoverParent,
        targetEl,
        linktext: link,
        sourcePath,
      });
    },
    onClick(feature, event) {
      if (ctx.isEditing()) {
        ctx.onSelect(feature.id);
        return;
      }
      const link = linkOf(feature);
      const sourcePath = ctx.sourcePath();
      if (link === null || sourcePath === null) return;
      if (!linkResolves(ctx.app, link, sourcePath)) {
        ctx.notify(`Note not found: ${link}`);
        return;
      }
      void ctx.app.workspace.openLinkText(link, sourcePath, Keymap.isModEvent(event));
    },
    onContextMenu(feature, event) {
      const maps = mapsOf(feature);
      const menu = new Menu();
      for (const map of maps) {
        menu.addItem((item) => item.setTitle(openMapTitle(map)).setIcon("map").onClick((e) => openMap(map, e as MouseEvent)));
      }
      let relinkable = false;
      if (ctx.relink && isBroken(feature)) {
        relinkable = true;
        menu.addItem((item) => item.setTitle(RELINK_TITLE).setIcon("link").onClick(() => ctx.relink?.(feature)));
      }
      const extended = ctx.extendMenu?.(feature, menu, event) ?? false;
      if (maps.length === 0 && !relinkable && !extended) return;
      event.preventDefault();
      closePopup();
      menu.showAtMouseEvent(event);
    },
  };
}
