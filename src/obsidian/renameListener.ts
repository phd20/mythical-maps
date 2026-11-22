/**
 * Rename listener (design D7, spec note-links "Rename listener keeps links
 * valid").
 *
 * When a non-`.map` vault file is renamed, every map that resolved a pin link
 * to the old path, or whose `image.path` was the old path, is rewritten
 * through `vault.process` with `rewriteForRename`. Only those link fields and
 * `image.path` change, and the result is written in canonical form. A file
 * that fails to parse is returned unchanged, so it is never rewritten.
 *
 * The handler runs as the index's `onRename` hook, before the index
 * re-resolves links, so `previouslyResolved` and `mapsReferencing` still show
 * the pre-rename state. It captures that state synchronously, before its
 * first `await`: a folder rename fires one event per child back to back, and
 * each must see the state from before any of them refreshed the index.
 */
import type { App, Plugin } from "obsidian";
import { parseMap } from "../core/parse";
import { rewriteForRename, type LinkResolver } from "../core/links";
import { stringifyMap } from "../core/serialize";
import { VaultMapIndex, createObsidianMapIndexDeps } from "./vaultMapIndex";

export interface RenameHandlerDeps {
  index: VaultMapIndex;
  /** Atomically transform a map file's text (Obsidian's `vault.process`). Skips missing files. */
  process(mapPath: string, fn: (text: string) => string): Promise<void>;
  /** Shortest linktext for `newPath` as seen from `mapPath`. */
  linktextFor(newPath: string, mapPath: string): string;
  /** Resolver for the vault state after the rename. */
  resolveNow: LinkResolver;
}

export type RenameHandler = (file: { path: string }, oldPath: string) => Promise<void>;

/** Rewrite one map's text for a rename; returns `text` itself when it is invalid or nothing changed. */
function rewriteText(
  text: string,
  mapPath: string,
  oldPath: string,
  newPath: string,
  previouslyResolved: Record<string, string | null>,
  deps: RenameHandlerDeps,
): string {
  const parsed = parseMap(text);
  if (!parsed.ok) return text;
  const out = rewriteForRename(parsed.map, {
    mapPath,
    oldPath,
    newPath,
    previouslyResolved,
    linktextFor: deps.linktextFor,
    resolveNow: deps.resolveNow,
  });
  return out.changed ? stringifyMap(out.map) : text;
}

/** A handler for `VaultMapIndex.register`'s `onRename`. Never throws; per-map errors are logged. */
export function createRenameHandler(deps: RenameHandlerDeps): RenameHandler {
  return async (file, oldPath) => {
    const newPath = file.path;
    // Snapshot synchronously, before the index refreshes (see module doc).
    const targets = deps.index
      .mapsReferencing(oldPath)
      .map((mapPath) => ({ mapPath, previouslyResolved: deps.index.previouslyResolved(mapPath) }));
    for (const { mapPath, previouslyResolved } of targets) {
      try {
        await deps.process(mapPath, (text) => rewriteText(text, mapPath, oldPath, newPath, previouslyResolved, deps));
      } catch (error) {
        console.error(`Mythical Maps: could not update links in ${mapPath} after rename of ${oldPath}`, error);
      }
    }
  };
}

/** `RenameHandlerDeps` backed by the Obsidian vault and metadata cache. */
export function createObsidianRenameDeps(app: App, index: VaultMapIndex): RenameHandlerDeps {
  return {
    index,
    process: async (mapPath, fn) => {
      const file = app.vault.getFileByPath(mapPath);
      if (!file) return;
      await app.vault.process(file, fn);
    },
    linktextFor: (newPath, mapPath) => {
      const file = app.vault.getFileByPath(newPath);
      // omitMdExtension: notes become `Name`, other files keep their extension.
      if (file) return app.metadataCache.fileToLinktext(file, mapPath, true);
      return newPath.endsWith(".md") ? newPath.slice(0, -3) : newPath;
    },
    resolveNow: {
      resolve: (linktext, sourcePath) => app.metadataCache.getFirstLinkpathDest(linktext, sourcePath)?.path ?? null,
    },
  };
}

/**
 * Build the vault map index, keep it current from vault events, and rewrite
 * affected maps on rename. Call once from the plugin's `onload`.
 */
export function registerMapLinkMaintenance(plugin: Plugin, app: App): VaultMapIndex {
  const index = new VaultMapIndex(createObsidianMapIndexDeps(app));
  const onRename = createRenameHandler(createObsidianRenameDeps(app, index));
  index.register(plugin, app, { onRename });
  return index;
}
