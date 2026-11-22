/**
 * Drill-down into a note's maps, Obsidian side (bead 6.3, design D8, spec
 * note-links "Drill-down into a note's maps").
 *
 * `createNoteMapsLookup` answers "which maps does the note this pin links to
 * list?" from Obsidian's metadata cache, reading the maps property name from
 * the settings at call time, so renaming the property in settings applies on
 * the next render. `registerNoteMaps` re-renders open views when a note's
 * frontmatter changes. Nothing here writes.
 */
import type { App, EventRef, TFile } from "obsidian";
import { collectLinks, type LinkResolver } from "../core/links";
import { noteMapsForLink, type NoteMap } from "../core/noteMaps";
import type { Feature } from "../core/schema";
import { linkOf } from "./linkActions";
import type { MythicalMapsSettings } from "./settings";
import { obsidianFrontmatterReader, obsidianLinkResolver, type StyledMapView } from "./styleOverrides";

export type { NoteMap };

/** Which maps a pin's linked note lists, as seen from the map file `mapPath`. */
export interface NoteMapsLookup {
  forPin(feature: Feature, mapPath: string): NoteMap[];
}

export function createNoteMapsLookup(app: App, getSettings: () => MythicalMapsSettings): NoteMapsLookup {
  const reader = obsidianFrontmatterReader(app);
  const resolver = obsidianLinkResolver(app);
  return {
    forPin(feature, mapPath) {
      const link = linkOf(feature);
      return link === null ? [] : noteMapsForLink(link, mapPath, getSettings().mapsProperty, reader, resolver);
    },
  };
}

export interface NoteMapsHost {
  registerEvent(ref: EventRef): void;
}

/** What `registerNoteMaps` returns. */
export interface NoteMaps {
  lookup: NoteMapsLookup;
  /** Handle a metadata cache change (exposed for tests). */
  noteChanged(file: TFile): void;
}

/**
 * Wire the lookup and re-render views whose pins link to a note whose cache
 * changed (its maps list may have changed). Settings changes are handled by
 * the plugin's `refreshAll`, which re-renders every view.
 */
export function registerNoteMaps(
  host: NoteMapsHost,
  app: App,
  getSettings: () => MythicalMapsSettings,
  openViews: () => StyledMapView[],
): NoteMaps {
  const resolver: LinkResolver = obsidianLinkResolver(app);
  const controller: NoteMaps = {
    lookup: createNoteMapsLookup(app, getSettings),
    noteChanged(file) {
      // With overrides enabled the style controller already re-renders these same views on this event.
      if (getSettings().overrides.enabled) return;
      for (const view of openViews()) {
        const shown = view.styledMap();
        if (!shown) continue;
        if (collectLinks(shown.map, shown.path, resolver).some((l) => l.resolvedPath === file.path)) view.refreshStyles();
      }
    },
  };
  host.registerEvent(app.metadataCache.on("changed", (file) => controller.noteChanged(file)));
  return controller;
}
