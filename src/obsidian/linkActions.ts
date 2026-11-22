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
 *   left untouched (the badge and "Relink…" are bead 6.6).
 * - Features without a link do nothing in view mode.
 */
import { Keymap, type App, type HoverParent, type Plugin } from "obsidian";
import { splitLinktext } from "../core/links";
import type { Feature } from "../core/schema";
import type { FeatureInteractions } from "../ui/featureRenderer";

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
}

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
  return {
    onHover(feature, event, targetEl) {
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
  };
}
