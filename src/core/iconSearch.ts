/**
 * Icon search for the pin's Icon field (spec map-editing "Icon suggestions").
 * Pure: the icon ids come from Obsidian (`getIconIds`).
 */

/** The name stored in `iconGlyph` for an icon id: bundled Lucide ids carry a `lucide-` prefix. */
export function iconName(id: string): string {
  return id.replace(/^lucide-/, "");
}

/** 0 exact, 1 starts with the query, 2 a later word does, 3 contains it, 4 contains every query word; null no match. */
function score(name: string, query: string, words: string[]): number | null {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(`-${query}`)) return 2;
  if (name.includes(query)) return 3;
  return words.every((w) => name.includes(w)) ? 4 : null;
}

/** Icon names matching `query`, best first then alphabetical. A blank query lists every icon. */
export function searchIcons(ids: readonly string[], query: string): string[] {
  const names = [...new Set(ids.map(iconName))].sort();
  const words = query.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return names;
  const joined = words.join("-");
  return names
    .map((name) => ({ name, rank: score(name.toLowerCase(), joined, words) }))
    .filter((m): m is { name: string; rank: number } => m.rank !== null)
    .sort((a, b) => a.rank - b.rank) // stable: ties stay alphabetical
    .map((m) => m.name);
}
