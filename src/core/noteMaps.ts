/**
 * Drill-down into a note's maps (design D8, spec note-links "Drill-down into a
 * note's maps").
 *
 * A pin's linked note may list `.map` files under a user-named frontmatter
 * property. These pure functions read that list and resolve each entry.
 * Obsidian behaviour is injected (`LinkResolver`, `FrontmatterReader`), so
 * nothing here imports `obsidian`. Unresolved or non-`.map` entries are
 * ignored silently; nothing is ever written.
 */
import { splitLinktext, type LinkResolver } from "./links";
import type { Frontmatter } from "./style";

/** Reads the frontmatter of the note a linktext points at, as seen from `sourcePath`. */
export interface NoteFrontmatterReader {
  read(linktext: string, sourcePath: string): Frontmatter | undefined;
}

export interface NoteMap {
  /** Display name: the entry's alias, else the map file's name without `.map`. */
  name: string;
  /** Vault path of the resolved `.map` file. */
  path: string;
}

/** An entry of the maps property reduced to its linkpath and optional alias. */
export interface MapEntry {
  linkpath: string;
  alias?: string;
}

const MAP_EXT = /\.map$/i;
const WIKILINK = /^\[\[([^\]]*)\]\]$/;

/** Parse one entry: `[[Path]]`, `[[Path|Alias]]`, `[[Path#x]]` or plain `Path`. Null when empty. */
export function parseMapEntry(raw: string): MapEntry | null {
  let text = raw.trim();
  const wiki = WIKILINK.exec(text);
  if (wiki) text = wiki[1] ?? "";
  const bar = text.indexOf("|");
  const target = (bar === -1 ? text : text.slice(0, bar)).trim();
  const alias = bar === -1 ? "" : text.slice(bar + 1).trim();
  const linkpath = splitLinktext(target).path.trim();
  if (linkpath === "") return null;
  return alias === "" ? { linkpath } : { linkpath, alias };
}

/**
 * The entries of `frontmatter[property]`. Accepts a list or a single string;
 * an unquoted `[[A]]` that YAML parsed as a nested list is flattened to its
 * text. Anything that is not a string is skipped.
 */
export function readMapEntries(frontmatter: Frontmatter | undefined, property: string): MapEntry[] {
  if (!frontmatter || property.trim() === "") return [];
  const raw = frontmatter[property];
  const items: unknown[] = Array.isArray(raw) ? raw : [raw];
  const out: MapEntry[] = [];
  for (const item of items) {
    let text: string | null = null;
    if (typeof item === "string") text = item;
    else if (Array.isArray(item)) {
      // Unquoted `[[A]]` parses as [["A"]]: rebuild the wikilink from its text.
      const inner = item.flat(Infinity).find((v): v is string => typeof v === "string");
      if (inner !== undefined) text = `[[${inner}]]`;
    }
    const entry = text === null ? null : parseMapEntry(text);
    if (entry) out.push(entry);
  }
  return out;
}

/**
 * The maps listed by the note a pin links to, that resolve to `.map` files.
 * Entries resolve from the note's own path, as Obsidian resolves a wikilink in
 * its frontmatter. A broken pin link or a note without the property gives `[]`.
 */
export function noteMapsForLink(
  link: string,
  mapPath: string,
  property: string,
  reader: NoteFrontmatterReader,
  resolver: LinkResolver,
): NoteMap[] {
  const { path } = splitLinktext(link);
  if (path === "") return [];
  const notePath = resolver.resolve(path, mapPath);
  if (notePath === null) return [];
  const entries = readMapEntries(reader.read(link, mapPath), property);
  const out: NoteMap[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const resolved = resolver.resolve(entry.linkpath, notePath);
    if (resolved === null || !MAP_EXT.test(resolved) || seen.has(resolved)) continue;
    seen.add(resolved);
    const base = resolved.slice(resolved.lastIndexOf("/") + 1).replace(MAP_EXT, "");
    out.push({ name: entry.alias ?? base, path: resolved });
  }
  return out;
}
