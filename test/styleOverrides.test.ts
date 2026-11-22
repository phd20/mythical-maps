import { describe, expect, it } from "vitest";
import { App, TFile, WorkspaceLeaf, type Plugin as MockPlugin } from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { VIEW_TYPE_MAP } from "../src/obsidian/constants";
import { MapView } from "../src/obsidian/mapView";
import { mergeSettings, type MythicalMapsSettings } from "../src/obsidian/settings";
import {
  createStyleResolver,
  linkedNotePaths,
  obsidianFrontmatterReader,
  obsidianLinkResolver,
  registerStyleOverrides,
  styleDefaults,
  type FrontmatterReader,
  type StyledMapView,
} from "../src/obsidian/styleOverrides";
import { parseMap } from "../src/core/parse";
import { stringifyMap } from "../src/core/serialize";
import { DEFAULT_STYLES, type ResolvedPinStyle } from "../src/core/style";
import type { Feature, MapDocument, PinFeature } from "../src/core/schema";
import type { BaseMapHandle } from "../src/ui/baseMap";
import type { RenderView } from "../src/ui/featureRenderer";

const MAP_PATH = "Maps/test.map";

const MAP_JSON = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "Maps/x.png", width: 100, height: 100 },
  features: [
    { id: "pkeep001", type: "pin", rank: "a0", pos: [-10, 10], link: "The Keep", style: { iconColor: "#123456" } },
    { id: "pinn0001", type: "pin", rank: "a1", pos: [-20, 20], link: "Rusty Flagon#Bar" },
    { id: "pnone001", type: "pin", rank: "a2", pos: [-30, 30] },
    { id: "pbrok001", type: "pin", rank: "a3", pos: [-40, 40], link: "Nowhere" },
    { id: "llabel01", type: "label", rank: "a4", pos: [-50, 50], name: "Here" },
  ],
});

function testMap(): MapDocument {
  const result = parseMap(MAP_JSON);
  if (!result.ok) throw new Error("fixture does not parse");
  return result.map;
}

const pin = (map: MapDocument, id: string): PinFeature => map.features.find((f) => f.id === id) as PinFeature;

/** Vault with two notes; the metadata cache resolves basenames and serves `frontmatter[path]`. */
function vaultApp(frontmatter: Record<string, Record<string, unknown> | undefined>): App {
  const app = new App();
  const notes: Record<string, TFile> = {
    "The Keep": new TFile("Places/The Keep.md"),
    "Rusty Flagon": new TFile("Places/Rusty Flagon.md"),
  };
  app.metadataCache.getFirstLinkpathDest = (linkpath: string) => notes[linkpath] ?? null;
  app.metadataCache.getFileCache = (file: TFile) => {
    const fm = frontmatter[file.path];
    return fm ? { frontmatter: fm } : {};
  };
  return app;
}

function settingsWith(overrides: Partial<MythicalMapsSettings["overrides"]>): MythicalMapsSettings {
  const s = mergeSettings(null);
  s.overrides = { ...s.overrides, ...overrides };
  return s;
}

const COLOR_ON = { enabled: true, colorProperty: "faction-color" };
const KEEP_FM = { "Places/The Keep.md": { "faction-color": "#AA2233", icon: "castle", shape: "shield" } };

describe("createStyleResolver", () => {
  const reader = (app: App): FrontmatterReader => obsidianFrontmatterReader(app as never);

  it("applies a configured colour override from the linked note when enabled", () => {
    const map = testMap();
    const resolve = createStyleResolver(settingsWith(COLOR_ON), reader(vaultApp(KEEP_FM)), MAP_PATH);
    expect((resolve(pin(map, "pkeep001")) as ResolvedPinStyle).iconColor).toBe("#AA2233");
  });

  it("applies icon and shape overrides when those properties are configured", () => {
    const map = testMap();
    const s = settingsWith({ enabled: true, iconProperty: "icon", shapeProperty: "shape" });
    const style = createStyleResolver(s, reader(vaultApp(KEEP_FM)), MAP_PATH)(pin(map, "pkeep001")) as ResolvedPinStyle;
    expect(style).toMatchObject({ iconGlyph: "castle", iconShape: "shield", iconColor: "#123456" });
  });

  it("ignores frontmatter when overrides are disabled", () => {
    const map = testMap();
    const s = settingsWith({ enabled: false, colorProperty: "faction-color" });
    const style = createStyleResolver(s, reader(vaultApp(KEEP_FM)), MAP_PATH)(pin(map, "pkeep001")) as ResolvedPinStyle;
    expect(style.iconColor).toBe("#123456");
  });

  it("ignores frontmatter when no property name is configured, without reading notes", () => {
    const map = testMap();
    let reads = 0;
    const counting: FrontmatterReader = {
      read: () => {
        reads++;
        return { "faction-color": "#AA2233" };
      },
    };
    const style = createStyleResolver(settingsWith({ enabled: true }), counting, MAP_PATH)(pin(map, "pkeep001")) as ResolvedPinStyle;
    expect(style.iconColor).toBe("#123456");
    expect(reads).toBe(0);
  });

  it("ignores an invalid colour value", () => {
    const map = testMap();
    const app = vaultApp({ "Places/The Keep.md": { "faction-color": "crimson" } });
    const style = createStyleResolver(settingsWith(COLOR_ON), reader(app), MAP_PATH)(pin(map, "pkeep001")) as ResolvedPinStyle;
    expect(style.iconColor).toBe("#123456");
  });

  it("leaves unlinked pins, broken links, notes without frontmatter and non-pins alone", () => {
    const map = testMap();
    const s = settingsWith(COLOR_ON);
    const resolve = createStyleResolver(s, reader(vaultApp(KEEP_FM)), MAP_PATH);
    expect((resolve(pin(map, "pnone001")) as ResolvedPinStyle).iconColor).toBe(s.defaultPinStyle.iconColor);
    expect((resolve(pin(map, "pbrok001")) as ResolvedPinStyle).iconColor).toBe(s.defaultPinStyle.iconColor);
    expect((resolve(pin(map, "pinn0001")) as ResolvedPinStyle).iconColor).toBe(s.defaultPinStyle.iconColor);
    const label = map.features.find((f) => f.id === "llabel01") as Feature;
    expect(resolve(label)).toEqual(DEFAULT_STYLES.label);
  });

  it("uses the default pin style from settings", () => {
    const s = settingsWith({});
    s.defaultPinStyle = { iconGlyph: "star", iconColor: "#00FF00", iconShape: "circle", iconSize: "small" };
    expect(styleDefaults(s).pin).toEqual(s.defaultPinStyle);
    const style = createStyleResolver(s, { read: () => undefined }, MAP_PATH)(pin(testMap(), "pnone001"));
    expect(style).toEqual(s.defaultPinStyle);
  });

  it("never mutates the feature", () => {
    const map = testMap();
    const before = stringifyMap(map);
    createStyleResolver(settingsWith(COLOR_ON), reader(vaultApp(KEEP_FM)), MAP_PATH)(pin(map, "pkeep001"));
    expect(stringifyMap(map)).toBe(before);
  });
});

describe("obsidianFrontmatterReader", () => {
  it("strips the subpath, and reads undefined for broken links or a same-file subpath", () => {
    const app = vaultApp({ "Places/Rusty Flagon.md": { a: 1 } });
    const r = obsidianFrontmatterReader(app as never);
    expect(r.read("Rusty Flagon#Bar", MAP_PATH)).toEqual({ a: 1 });
    expect(r.read("Nowhere", MAP_PATH)).toBeUndefined();
    expect(r.read("#Heading", MAP_PATH)).toBeUndefined();
    expect(r.read("The Keep", MAP_PATH)).toBeUndefined();
  });
});

describe("linkedNotePaths", () => {
  it("lists the resolved note paths of linked pins", () => {
    const paths = linkedNotePaths(testMap(), MAP_PATH, obsidianLinkResolver(vaultApp({}) as never));
    expect([...paths].sort()).toEqual(["Places/Rusty Flagon.md", "Places/The Keep.md"]);
  });
});

describe("registerStyleOverrides", () => {
  function setup(settings: MythicalMapsSettings) {
    const app = vaultApp(KEEP_FM);
    const refreshes: number[] = [0];
    const view: StyledMapView = { styledMap: () => ({ map: testMap(), path: MAP_PATH }), refreshStyles: () => refreshes[0]!++ };
    const events: unknown[] = [];
    const controller = registerStyleOverrides({ registerEvent: (ref) => events.push(ref) }, app as never, () => settings, () => [view]);
    return { app, controller, events, count: () => refreshes[0] };
  }

  it("registers a metadata cache 'changed' listener", () => {
    const { events } = setup(settingsWith(COLOR_ON));
    expect(events).toEqual([expect.objectContaining({ name: "changed" })]);
  });

  it("re-renders a view when a note one of its pins links to changes", () => {
    const { app, count } = setup(settingsWith(COLOR_ON));
    app.metadataCache.trigger("changed", new TFile("Places/The Keep.md"));
    expect(count()).toBe(1);
  });

  it("does not re-render for an unrelated note, or when overrides are disabled", () => {
    const off = setup(settingsWith({ enabled: false, colorProperty: "faction-color" }));
    off.app.metadataCache.trigger("changed", new TFile("Places/The Keep.md"));
    expect(off.count()).toBe(0);
    const on = setup(settingsWith(COLOR_ON));
    on.app.metadataCache.trigger("changed", new TFile("Places/Westmarch.md"));
    expect(on.count()).toBe(0);
  });

  it("refreshAll re-renders every open view; viewFor builds a resolver", () => {
    const { controller, count } = setup(settingsWith(COLOR_ON));
    controller.refreshAll();
    expect(count()).toBe(1);
    const style = controller.viewFor(MAP_PATH).resolveStyle?.(pin(testMap(), "pkeep001")) as ResolvedPinStyle;
    expect(style.iconColor).toBe("#AA2233");
  });
});

describe("plugin and map view wiring", () => {
  async function openMap(settings: Partial<MythicalMapsSettings["overrides"]>) {
    const app = vaultApp({ "Places/The Keep.md": { "faction-color": "#AA2233" } });
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    await plugin.onload();
    plugin.settings.overrides = { ...plugin.settings.overrides, ...settings };
    const leaf = new WorkspaceLeaf(app);
    app.workspace.leaves.push(leaf);
    const view = (plugin as unknown as MockPlugin).views[VIEW_TYPE_MAP]!(leaf) as unknown as MapView;
    leaf.view = view as never;
    const renders: Array<{ model: MapDocument; view: RenderView | undefined }> = [];
    view.mountMap = () =>
      ({
        refresh: () => {},
        destroy: () => {},
        render: (model: MapDocument, v?: RenderView) => renders.push({ model, view: v }),
        currentViewport: () => null,
      }) as unknown as BaseMapHandle;
    (view as unknown as { loadFile(file: TFile, data: string): void }).loadFile(new TFile(MAP_PATH), MAP_JSON);
    const keepColor = () => {
      const last = renders[renders.length - 1]!;
      return (last.view?.resolveStyle?.(pin(last.model, "pkeep001")) as ResolvedPinStyle).iconColor;
    };
    return { app, plugin, view, renders, keepColor };
  }

  it("renders with the linked note's override and re-renders when that note changes", async () => {
    const { app, renders, keepColor } = await openMap(COLOR_ON);
    expect(renders).toHaveLength(1);
    expect(keepColor()).toBe("#AA2233");
    app.metadataCache.getFileCache = () => ({ frontmatter: { "faction-color": "#00AA00" } });
    app.metadataCache.trigger("changed", new TFile("Places/The Keep.md"));
    expect(renders).toHaveLength(2);
    expect(keepColor()).toBe("#00AA00");
    app.metadataCache.trigger("changed", new TFile("Places/Westmarch.md"));
    expect(renders).toHaveLength(2);
    expect(app.vault.modified).toEqual([]);
  });

  it("draws stored styles when disabled, and re-renders all open maps after a settings save", async () => {
    const { app, plugin, renders, keepColor } = await openMap({ enabled: false, colorProperty: "faction-color" });
    expect(keepColor()).toBe("#123456");
    plugin.settings.overrides.enabled = true;
    await plugin.saveSettings();
    expect(renders).toHaveLength(2);
    expect(keepColor()).toBe("#AA2233");
    expect(app.vault.modified).toEqual([]);
  });
});
