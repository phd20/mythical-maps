/**
 * Frontmatter style overrides in the renderer (bead 7.1, design D9, spec
 * plugin-settings "Optional frontmatter style overrides").
 *
 * The core `resolveStyle` already applies overrides from a frontmatter object;
 * this module supplies that frontmatter from Obsidian. A `FrontmatterReader`
 * resolves a pin's linktext from the map file and reads the linked note's
 * cached frontmatter. Nothing here writes: overrides live only in the
 * rendered layers, never in the `.map` file or the note.
 *
 * Open map views re-render their features when the metadata cache reports a
 * change to a note one of their pins links to, and when the settings change.
 */
import type { App, EventRef, TFile } from "obsidian";
import { collectLinks, splitLinktext, type LinkResolver } from "../core/links";
import type { Feature, MapDocument } from "../core/schema";
import { DEFAULT_STYLES, resolveStyle, type Frontmatter, type ResolvedStyle, type StyleDefaults } from "../core/style";
import type { RenderView } from "../ui/featureRenderer";
import { toOverrideConfig, type MythicalMapsSettings } from "./settings";

/** Reads the frontmatter of the note a linktext points at, as seen from `sourcePath`. */
export interface FrontmatterReader {
  read(linktext: string, sourcePath: string): Frontmatter | undefined;
}

/** `LinkResolver` over Obsidian's metadata cache. */
export function obsidianLinkResolver(app: App): LinkResolver {
  return {
    resolve: (linkpath, sourcePath) => app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)?.path ?? null,
  };
}

/** `FrontmatterReader` over Obsidian's metadata cache. Broken links and notes without frontmatter read as `undefined`. */
export function obsidianFrontmatterReader(app: App): FrontmatterReader {
  return {
    read(linktext, sourcePath) {
      const { path } = splitLinktext(linktext);
      if (path === "") return undefined;
      const file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
      if (!file) return undefined;
      const frontmatter: unknown = app.metadataCache.getFileCache(file)?.frontmatter;
      return typeof frontmatter === "object" && frontmatter !== null ? (frontmatter as Frontmatter) : undefined;
    },
  };
}

/** Plugin defaults with the user's default pin style from settings. */
export function styleDefaults(settings: MythicalMapsSettings): StyleDefaults {
  return { ...DEFAULT_STYLES, pin: { ...settings.defaultPinStyle } };
}

/**
 * The renderer's `resolveStyle` for one map: settings defaults, then the
 * feature's stored style, then (linked pins only, when enabled and
 * configured) valid values from the linked note's frontmatter.
 */
export function createStyleResolver(
  settings: MythicalMapsSettings,
  reader: FrontmatterReader,
  mapPath: string,
): (feature: Feature) => ResolvedStyle {
  const defaults = styleDefaults(settings);
  const overrides = toOverrideConfig(settings);
  const active =
    overrides.enabled && [overrides.iconProperty, overrides.colorProperty, overrides.shapeProperty].some((p) => p !== undefined);
  return (feature) => {
    const linked = active && feature.type === "pin" && typeof feature.link === "string" ? feature.link : null;
    const frontmatter = linked === null ? undefined : reader.read(linked, mapPath);
    return resolveStyle(feature, defaults, overrides, frontmatter);
  };
}

/** Vault paths of the notes the map's pins resolve to (broken links omitted). */
export function linkedNotePaths(map: MapDocument, mapPath: string, resolver: LinkResolver): Set<string> {
  const out = new Set<string>();
  for (const info of collectLinks(map, mapPath, resolver)) if (info.resolvedPath !== null) out.add(info.resolvedPath);
  return out;
}

/** What the controller needs from an open map view. */
export interface StyledMapView {
  /** The map the view shows and its file path, or null when it shows none (empty or error state). */
  styledMap(): { map: MapDocument; path: string } | null;
  /** Re-render the view's features with freshly resolved styles. */
  refreshStyles(): void;
}

export interface StyleOverrides {
  /** The `RenderView` a map view passes to its renderer. */
  viewFor(mapPath: string): RenderView;
  /** Re-render every open map view (after a settings change). */
  refreshAll(): void;
  /** Handle a metadata cache change: re-render the views with a pin linked to `file`. Exposed for tests. */
  noteChanged(file: TFile): void;
}

export interface StyleOverrideHost {
  registerEvent(ref: EventRef): void;
}

/**
 * Wire style overrides: subscribes to `metadataCache.on("changed")` through
 * `host.registerEvent`, so it is removed when the plugin unloads.
 */
export function registerStyleOverrides(
  host: StyleOverrideHost,
  app: App,
  getSettings: () => MythicalMapsSettings,
  openViews: () => StyledMapView[],
): StyleOverrides {
  const reader = obsidianFrontmatterReader(app);
  const resolver = obsidianLinkResolver(app);

  const controller: StyleOverrides = {
    viewFor: (mapPath) => ({ resolveStyle: createStyleResolver(getSettings(), reader, mapPath) }),
    refreshAll() {
      for (const view of openViews()) view.refreshStyles();
    },
    noteChanged(file) {
      // With overrides off, a note's frontmatter cannot change how a pin looks.
      if (!getSettings().overrides.enabled) return;
      for (const view of openViews()) {
        const shown = view.styledMap();
        if (shown && linkedNotePaths(shown.map, shown.path, resolver).has(file.path)) view.refreshStyles();
      }
    },
  };

  host.registerEvent(app.metadataCache.on("changed", (file) => controller.noteChanged(file)));
  return controller;
}
