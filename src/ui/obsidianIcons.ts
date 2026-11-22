/** Obsidian's bundled Lucide icons as the feature renderer's `IconProvider` (design D5 icon note). */
import { getIcon, setIcon } from "obsidian";
import type { IconProvider } from "./featureRenderer";

export const obsidianIcons: IconProvider = {
  has: (name) => getIcon(name) !== null,
  set: (el, name) => setIcon(el, name),
};
