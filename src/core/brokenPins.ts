/**
 * "Find broken pins" scan (bead 6.7, spec note-links "Find broken pins
 * command") and the pure text edit behind its "Relink…" action.
 *
 * The scan works over an injected `BrokenPinSource` (the vault map index) and
 * `LinkResolver`, and re-resolves every link so its answer is current even if
 * the index's cached resolution is stale. Invalid maps have no links and so
 * never appear. Nothing here changes a `link`: broken pins are only reported.
 */
import { parseMap } from "./parse";
import { stringifyMap } from "./serialize";
import { resolveLink, type LinkResolver } from "./links";

export interface LinkedPinRef {
  featureId: string;
  link: string;
}

/** The maps and linked pins to scan; implemented by the vault map index. */
export interface BrokenPinSource {
  mapPaths(): string[];
  /** The linked pins of a map; empty for an invalid or unknown map. */
  linkedPins(mapPath: string): LinkedPinRef[];
}

export interface BrokenPinGroup {
  mapPath: string;
  pins: LinkedPinRef[];
}

/** Broken pins grouped by map. Only maps with at least one broken pin are listed, sorted by path; pins keep their order. */
export function scanBrokenPins(source: BrokenPinSource, resolver: LinkResolver): BrokenPinGroup[] {
  const groups: BrokenPinGroup[] = [];
  for (const mapPath of [...source.mapPaths()].sort()) {
    const pins = source.linkedPins(mapPath).filter((p) => resolveLink(p.link, mapPath, resolver) === null);
    if (pins.length > 0) groups.push({ mapPath, pins });
  }
  return groups;
}

/**
 * Set one pin's `link` in a map file's text, in canonical form. Returns the
 * input text unchanged when the file does not parse or has no such pin, so a
 * file that failed to parse is never rewritten. An empty `link` is refused
 * (links are never cleared).
 */
export function relinkInText(text: string, featureId: string, link: string): string {
  if (link === "") return text;
  const parsed = parseMap(text);
  if (!parsed.ok) return text;
  let found = false;
  const features = parsed.map.features.map((f) => {
    if (f.id !== featureId || f.type !== "pin") return f;
    found = true;
    return { ...f, link };
  });
  if (!found) return text;
  return stringifyMap({ ...parsed.map, features });
}
