/**
 * Vault map index (design D7, spec note-links "Rename listener" and
 * "Find broken pins").
 *
 * Caches every `.map` file's image path and pin links, with what each link
 * resolved to when last indexed. The rename listener (bead 6.5) reads
 * `previouslyResolved` and `mapsReferencing` from it; the broken-pins command
 * reads `brokenPins`.
 *
 * The index works on a small injected `VaultMapIndexDeps` so it can be
 * tested without Obsidian; `createObsidianMapIndexDeps` adapts the real App.
 * Invalid maps are kept with `ok: false` and no links. Nothing here throws.
 */
import type { App, Plugin, TAbstractFile, TFile } from "obsidian";
import { parseMap } from "../core/parse";
import { collectLinks, splitLinktext, type LinkInfo, type LinkResolver } from "../core/links";
import { MAP_EXTENSION } from "./constants";

export interface VaultMapIndexDeps {
  /** Vault paths of every `.map` file. */
  listMapFiles(): string[];
  /** Text of a vault file. May reject when the file is gone. */
  read(path: string): Promise<string>;
  /** Resolver for the current vault state. */
  resolver: LinkResolver;
}

export interface MapIndexEntry {
  /** False when the file failed to parse; such maps have no links. */
  ok: boolean;
  imagePath?: string;
  links: LinkInfo[];
}

export interface BrokenPin {
  mapPath: string;
  featureId: string;
  link: string;
}

export interface RegisterOptions {
  /**
   * Called for a rename of a non-`.map` file, before the index re-resolves
   * links, so `previouslyResolved` still reflects the old vault state.
   */
  onRename?(file: TAbstractFile, oldPath: string): void | Promise<void>;
}

const isMapPath = (path: string): boolean => path.endsWith(`.${MAP_EXTENSION}`);

/** A TFile (not a folder) with the `.map` extension. Duck-typed so no runtime import of `obsidian` is needed. */
const isMapFile = (file: TAbstractFile): boolean =>
  "extension" in file && (file as TFile).extension === MAP_EXTENSION;

export class VaultMapIndex {
  private readonly entries = new Map<string, MapIndexEntry>();
  /** Serialises build/update/remove/rename so they apply in call order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: VaultMapIndexDeps) {}

  private enqueue(task: () => Promise<void> | void): Promise<void> {
    const next = this.queue.then(task).catch((error: unknown) => {
      console.error("Mythical Maps: map index update failed", error);
    });
    this.queue = next;
    return next;
  }

  /** Resolves once every queued operation has applied. */
  whenIdle(): Promise<void> {
    return this.queue;
  }

  private async readEntry(path: string): Promise<MapIndexEntry | null> {
    let text: string;
    try {
      text = await this.deps.read(path);
    } catch {
      return null; // file vanished
    }
    const result = parseMap(text);
    if (!result.ok) return { ok: false, links: [] };
    return {
      ok: true,
      imagePath: result.map.image.path,
      links: collectLinks(result.map, path, this.deps.resolver),
    };
  }

  private resolve(link: string, mapPath: string): string | null {
    const { path } = splitLinktext(link);
    if (path === "") return null;
    return this.deps.resolver.resolve(path, mapPath);
  }

  /** Re-index every `.map` file in the vault, replacing the current state. */
  build(): Promise<void> {
    return this.enqueue(async () => {
      const paths = this.deps.listMapFiles();
      const read = await Promise.all(paths.map(async (p) => [p, await this.readEntry(p)] as const));
      this.entries.clear();
      for (const [path, entry] of read) if (entry) this.entries.set(path, entry);
    });
  }

  /** Re-read one map (after create or modify). Removes it when it can no longer be read. */
  update(path: string): Promise<void> {
    return this.enqueue(async () => {
      const entry = await this.readEntry(path);
      if (entry) this.entries.set(path, entry);
      else this.entries.delete(path);
    });
  }

  /** Forget a deleted map. */
  remove(path: string): Promise<void> {
    return this.enqueue(() => {
      this.entries.delete(path);
    });
  }

  /** Move a renamed map's entry; its links are re-resolved from the new path. */
  rename(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(() => {
      const entry = this.entries.get(oldPath);
      if (!entry) return;
      this.entries.delete(oldPath);
      this.entries.set(newPath, {
        ...entry,
        links: entry.links.map((l) => ({ ...l, resolvedPath: this.resolve(l.link, newPath) })),
      });
    });
  }

  /** Re-resolve every indexed link against the current vault, without re-reading files. */
  refreshResolution(): void {
    for (const [mapPath, entry] of this.entries) {
      entry.links = entry.links.map((l) => ({ ...l, resolvedPath: this.resolve(l.link, mapPath) }));
    }
  }

  /** The index entry for a map, if indexed. */
  get(mapPath: string): MapIndexEntry | undefined {
    return this.entries.get(mapPath);
  }

  /** Every indexed map path (valid or not), sorted. */
  allMaps(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** Maps with a pin resolving to `path`, or whose `image.path` is `path`. Sorted. */
  mapsReferencing(path: string): string[] {
    const out: string[] = [];
    for (const [mapPath, entry] of this.entries) {
      if (entry.imagePath === path || entry.links.some((l) => l.resolvedPath === path)) out.push(mapPath);
    }
    return out.sort();
  }

  /** What each linked pin of a map resolved to when last indexed, by feature id. */
  previouslyResolved(mapPath: string): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const l of this.entries.get(mapPath)?.links ?? []) out[l.featureId] = l.resolvedPath;
    return out;
  }

  /** Every linked pin whose link does not resolve, across all valid maps, ordered by map path. */
  brokenPins(): BrokenPin[] {
    const out: BrokenPin[] = [];
    for (const mapPath of this.allMaps()) {
      for (const l of this.entries.get(mapPath)?.links ?? []) {
        if (l.resolvedPath === null) out.push({ mapPath, featureId: l.featureId, link: l.link });
      }
    }
    return out;
  }

  /**
   * Build on layout ready and keep the index current from vault events.
   * Events are registered inside `onLayoutReady` so the initial vault load
   * does not fire a `create` per file. Non-`.map` create/delete/rename only
   * re-resolve links; this never writes files.
   */
  register(plugin: Plugin, app: App, options: RegisterOptions = {}): void {
    app.workspace.onLayoutReady(() => {
      void this.build();
      plugin.registerEvent(
        app.vault.on("create", (file) => {
          if (isMapFile(file)) void this.update(file.path);
          else this.refreshResolution();
        }),
      );
      plugin.registerEvent(
        app.vault.on("modify", (file) => {
          if (isMapFile(file)) void this.update(file.path);
        }),
      );
      plugin.registerEvent(
        app.vault.on("delete", (file) => {
          if (isMapFile(file)) void this.remove(file.path);
          else this.refreshResolution();
        }),
      );
      plugin.registerEvent(
        app.vault.on("rename", (file, oldPath) => {
          if (isMapFile(file) || isMapPath(oldPath)) {
            if (isMapFile(file) && isMapPath(oldPath)) void this.rename(oldPath, file.path);
            else if (isMapFile(file)) void this.update(file.path);
            else void this.remove(oldPath);
            return;
          }
          void (async () => {
            try {
              await options.onRename?.(file, oldPath);
            } finally {
              this.refreshResolution();
            }
          })();
        }),
      );
    });
  }
}

/** `VaultMapIndexDeps` backed by the Obsidian vault and metadata cache. */
export function createObsidianMapIndexDeps(app: App): VaultMapIndexDeps {
  return {
    listMapFiles: () =>
      app.vault
        .getFiles()
        .filter((f) => f.extension === MAP_EXTENSION)
        .map((f) => f.path),
    read: async (path) => {
      const file = app.vault.getFileByPath(path);
      if (!file) throw new Error(`No file at ${path}`);
      return app.vault.cachedRead(file);
    },
    resolver: {
      resolve: (linktext, sourcePath) => app.metadataCache.getFirstLinkpathDest(linktext, sourcePath)?.path ?? null,
    },
  };
}
