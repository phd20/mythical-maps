/**
 * Keeps broken-link badges current (bead 6.6, spec note-links "Broken links
 * are visible, never deleted"). A pin's badge depends on whether its `link`
 * resolves, which changes when a note is created, deleted or renamed (also
 * outside Obsidian, which the vault reports on its next scan). Each such event
 * re-renders the open map views. Nothing here writes: `link` is never
 * cleared because it does not resolve.
 */
import type { App, EventRef } from "obsidian";
import type { StyledMapView } from "./styleOverrides";

export interface BrokenLinksHost {
  registerEvent(ref: EventRef): void;
}

/** Debounce for bursts of vault events (folder moves, startup indexing), in ms. */
export const REFRESH_DELAY = 100;

export function registerBrokenLinks(host: BrokenLinksHost, app: App, openViews: () => StyledMapView[]): { refresh(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const refresh = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      for (const view of openViews()) view.refreshStyles();
    }, REFRESH_DELAY);
  };
  host.registerEvent(app.metadataCache.on("changed", refresh)); // note created or edited (indexed)
  host.registerEvent(app.metadataCache.on("deleted", refresh));
  host.registerEvent(app.vault.on("rename", refresh));
  host.registerEvent(app.vault.on("delete", refresh));
  return { refresh };
}
