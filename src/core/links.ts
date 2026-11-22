/**
 * Pin link logic (design D7, spec note-links).
 *
 * Pure functions over a `MapDocument`. Obsidian behaviour is injected: a
 * `LinkResolver` (wrapping `metadataCache.getFirstLinkpathDest`) and a
 * `linktextFor` function (wrapping `metadataCache.fileToLinktext`).
 *
 * Links are never cleared or deleted because they do not resolve; broken
 * pins are only reported.
 */
import type { Feature, MapDocument, PinFeature } from "./schema";

/** Resolves the path part of a linktext (no `#subpath`) from a source file. */
export interface LinkResolver {
  resolve(linktext: string, sourcePath: string): string | null;
}

export interface LinkInfo {
  featureId: string;
  link: string;
  resolvedPath: string | null;
}

/**
 * Split linktext into its path and subpath. The subpath keeps its leading `#`
 * (`#Heading` or `#^block`), or is `""` when there is none.
 */
export function splitLinktext(link: string): { path: string; subpath: string } {
  const hash = link.indexOf("#");
  if (hash === -1) return { path: link, subpath: "" };
  return { path: link.slice(0, hash), subpath: link.slice(hash) };
}

/** Resolve a full linktext (subpath stripped) with the given resolver. */
function resolveLink(link: string, mapPath: string, resolver: LinkResolver): string | null {
  const { path } = splitLinktext(link);
  if (path === "") return null; // same-file subpath; a map has no headings
  return resolver.resolve(path, mapPath);
}

const isLinkedPin = (f: Feature): f is PinFeature & { link: string } => f.type === "pin" && typeof f.link === "string";

/** Every pin with a link, with what it resolves to (null when broken). */
export function collectLinks(map: MapDocument, mapPath: string, resolver: LinkResolver): LinkInfo[] {
  return map.features.filter(isLinkedPin).map((f) => ({
    featureId: f.id,
    link: f.link,
    resolvedPath: resolveLink(f.link, mapPath, resolver),
  }));
}

/** The linked pins whose link does not resolve. */
export function findBroken(map: MapDocument, mapPath: string, resolver: LinkResolver): LinkInfo[] {
  return collectLinks(map, mapPath, resolver).filter((l) => l.resolvedPath === null);
}

export interface RenameContext {
  /** Path of the `.map` file being rewritten. */
  mapPath: string;
  /** Vault path of the renamed file before the rename. */
  oldPath: string;
  /** Vault path of the renamed file after the rename. */
  newPath: string;
  /** What each pin resolved to before the rename, by feature id (from the vault index). */
  previouslyResolved: Record<string, string | null>;
  /** Shortest linktext for `newPath` as seen from `mapPath` (Obsidian's `fileToLinktext`). */
  linktextFor(newPath: string, mapPath: string): string;
  /** Resolver for the vault state after the rename. */
  resolveNow: LinkResolver;
}

/**
 * Rewrite a map after a vault rename. Changes only pin `link` fields that
 * resolved to `oldPath` and no longer resolve to `newPath` (keeping their
 * `#subpath`), and `image.path` when it equals `oldPath`. Returns the input
 * object itself when nothing changed.
 */
export function rewriteForRename(map: MapDocument, ctx: RenameContext): { map: MapDocument; changed: boolean } {
  const { mapPath, oldPath, newPath, previouslyResolved, linktextFor, resolveNow } = ctx;
  // The map file itself moved: links are relative and the index re-resolves them.
  if (oldPath === mapPath || oldPath === newPath) return { map, changed: false };

  let changed = false;
  const features = map.features.map((f) => {
    if (!isLinkedPin(f)) return f;
    if (previouslyResolved[f.id] !== oldPath) return f;
    if (resolveLink(f.link, mapPath, resolveNow) === newPath) return f;
    const link = linktextFor(newPath, mapPath) + splitLinktext(f.link).subpath;
    if (link === f.link) return f;
    changed = true;
    return { ...f, link };
  });

  const imageMoved = map.image.path === oldPath;
  if (!changed && !imageMoved) return { map, changed: false };

  return {
    map: {
      ...map,
      image: imageMoved ? { ...map.image, path: newPath } : map.image,
      features: changed ? features : map.features,
    },
    changed: true,
  };
}
