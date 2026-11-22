/**
 * Choices for the pin link picker (bead 6.1, spec note-links "Set link with
 * picker"). Pure: Obsidian's `fileToLinktext` is injected, so a picked note
 * becomes its shortest unambiguous linktext as seen from the map file.
 */

export interface LinkChoice {
  /** Vault path of the note. */
  path: string;
  /** Linktext stored in the pin's `link`. */
  linktext: string;
}

export type LinktextFor = (notePath: string, mapPath: string) => string;

const isNote = (path: string): boolean => path.toLowerCase().endsWith(".md");

/** One choice per markdown note, sorted by path. */
export function linkChoices(paths: readonly string[], mapPath: string, linktextFor: LinktextFor): LinkChoice[] {
  return paths
    .filter(isNote)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path) => ({ path, linktext: linktextFor(path, mapPath) }));
}
