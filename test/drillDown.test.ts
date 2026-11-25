import { beforeEach, describe, expect, it } from "vitest";
import type { App as ObsidianApp, HoverParent } from "obsidian";
import { App, Menu, TFile } from "./mocks/obsidian";
import { featureLayers, type MockDivIcon, type MockFeatureLayer } from "./mocks/leaflet";
import type * as L from "leaflet";
import { createLinkInteractions, openMapTitle, type LinkActionContext } from "../src/obsidian/linkActions";
import { createNoteMapsLookup, registerNoteMaps } from "../src/obsidian/noteMaps";
import { mergeSettings } from "../src/obsidian/settings";
import { createFeatureRenderer } from "../src/ui/featureRenderer";
import type { Feature, MapDocument } from "../src/core/schema";

const MAP_PATH = "Maps/world.map";
const NOTE_FM: Record<string, Record<string, unknown>> = {
  "Places/Westmarch.md": { maps: ["[[Westmarch.map]]", "[[Westmarch Sewers.map]]", "[[Nowhere.map]]"], "region-maps": ["[[Westmarch.map]]"] },
  "Places/Plain.md": {},
};
const FILES = ["Places/Westmarch.md", "Places/Plain.md", "Maps/Westmarch.map", "Maps/Westmarch Sewers.map"];

function vault(): App {
  const app = new App();
  const files = FILES.map((p) => new TFile(p));
  app.metadataCache.getFirstLinkpathDest = (linkpath: string) =>
    files.find((f) => f.path === linkpath || f.name === linkpath || f.basename === linkpath) ?? null;
  app.metadataCache.getFileCache = ((file: TFile) => ({ frontmatter: NOTE_FM[file.path] })) as never;
  return app;
}

const pin = (link?: string): Feature => ({ id: "ppin0001", type: "pin", rank: "a0", pos: [0, 0], ...(link ? { link } : {}) });
const evt = (over: Partial<MouseEvent> = {}) =>
  ({ button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, preventDefault() { (this as { prevented?: boolean }).prevented = true; }, ...over }) as unknown as MouseEvent;

describe("note maps lookup", () => {
  it("lists resolving maps of the linked note, ignoring unresolved entries", () => {
    const lookup = createNoteMapsLookup(vault() as unknown as ObsidianApp, () => mergeSettings(null));
    expect(lookup.forPin(pin("Westmarch"), MAP_PATH)).toEqual([
      { name: "Westmarch", path: "Maps/Westmarch.map" },
      { name: "Westmarch Sewers", path: "Maps/Westmarch Sewers.map" },
    ]);
    expect(lookup.forPin(pin("Plain"), MAP_PATH)).toEqual([]);
    expect(lookup.forPin(pin(), MAP_PATH)).toEqual([]);
    expect(lookup.forPin(pin("Missing"), MAP_PATH)).toEqual([]);
  });

  it("follows the maps property setting at call time", () => {
    const settings = mergeSettings(null);
    const lookup = createNoteMapsLookup(vault() as unknown as ObsidianApp, () => settings);
    settings.mapsProperty = "region-maps";
    expect(lookup.forPin(pin("Westmarch"), MAP_PATH).map((m) => m.name)).toEqual(["Westmarch"]);
    settings.mapsProperty = "nothing";
    expect(lookup.forPin(pin("Westmarch"), MAP_PATH)).toEqual([]);
  });

  it("re-renders views that link to a changed note (overrides off)", () => {
    const app = vault();
    const refreshed: string[] = [];
    const map = { type: "mythical-map", version: 1, image: { path: "x.png", width: 1, height: 1 }, features: [pin("Westmarch")] } as MapDocument;
    const view = { styledMap: () => ({ map, path: MAP_PATH }), refreshStyles: () => refreshed.push("r") };
    const host = { registerEvent: () => {} };
    const nm = registerNoteMaps(host, app as unknown as ObsidianApp, () => mergeSettings(null), () => [view]);
    nm.noteChanged(new TFile("Places/Plain.md") as never);
    expect(refreshed).toEqual([]);
    nm.noteChanged(new TFile("Places/Westmarch.md") as never);
    expect(refreshed).toEqual(["r"]);
  });
});

function harness(maps = true) {
  const app = vault();
  const ctx: LinkActionContext = {
    app: app as unknown as ObsidianApp,
    hoverParent: { hoverPopover: null } as HoverParent,
    sourcePath: () => MAP_PATH,
    isEditing: () => false,
    onSelect: () => {},
    notify: () => {},
    noteMaps: (f) => (maps ? createNoteMapsLookup(app as unknown as ObsidianApp, () => mergeSettings(null)).forPin(f, MAP_PATH) : []),
  };
  return { app, hooks: createLinkInteractions(ctx) };
}

describe("context menu", () => {
  it("shows Open map entries and opens the chosen map, honouring Mod", () => {
    const shown: Menu[] = [];
    const original = Menu.prototype.showAtMouseEvent;
    Menu.prototype.showAtMouseEvent = function (this: Menu, e: unknown) {
      shown.push(this);
      return original.call(this, e);
    };
    try {
      const h = harness();
      const e = evt();
      h.hooks.onContextMenu?.(pin("Westmarch"), e);
      expect((e as unknown as { prevented?: boolean }).prevented).toBe(true);
      const menu = shown[0]!;
      expect(menu.items.map((i) => i.title)).toEqual(["Open map: Westmarch", "Open map: Westmarch Sewers"]);
      menu.items[1]!.clickHandler?.(evt({ metaKey: true }));
      menu.items[0]!.clickHandler?.(evt());
      expect(h.app.workspace.openedLinks).toEqual([
        { linktext: "Maps/Westmarch Sewers.map", sourcePath: MAP_PATH, newLeaf: "tab" },
        { linktext: "Maps/Westmarch.map", sourcePath: MAP_PATH, newLeaf: false },
      ]);
    } finally {
      Menu.prototype.showAtMouseEvent = original;
    }
  });

  it("does nothing (and leaves the native menu) for pins without maps", () => {
    const e = evt();
    harness().hooks.onContextMenu?.(pin("Plain"), e);
    harness(false).hooks.onContextMenu?.(pin("Westmarch"), e);
    expect((e as unknown as { prevented?: boolean }).prevented).toBeUndefined();
  });
});

describe("hover popup", () => {
  class FakeEl {
    children: FakeEl[] = [];
    listeners: Record<string, Array<(e: unknown) => void>> = {};
    style: Record<string, string> = {};
    className = "";
    textContent = "";
    offsetWidth = 0;
    offsetHeight = 0;
    parent: FakeEl | null = null;
    ownerDocument = { createElement: () => new FakeEl() };
    addEventListener(t: string, fn: (e: unknown) => void): void {
      (this.listeners[t] ??= []).push(fn);
    }
    appendChild(c: FakeEl): FakeEl {
      c.parent = this;
      this.children.push(c);
      return c;
    }
    remove(): void {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    }
    getBoundingClientRect() {
      return { left: 10, right: 42, bottom: 50, top: 20 };
    }
    closest(sel: string): FakeEl | null {
      return sel === ".mythical-map-view" ? root : null;
    }
  }
  const root = new FakeEl();
  const pinEl = new FakeEl();
  beforeEach(() => {
    root.children = [];
  });

  it("lists Open map buttons beside the pin and opens one on click", () => {
    const h = harness();
    h.hooks.onHover?.(pin("Westmarch"), evt(), pinEl as unknown as HTMLElement);
    const popup = root.children[0]!;
    expect(popup.className).toBe("mythical-map-drilldown-popup");
    expect(popup.children.map((c) => c.textContent)).toEqual(["Open map: Westmarch", "Open map: Westmarch Sewers"]);
    popup.children[1]!.listeners.click![0]!(evt({ ctrlKey: true, altKey: true }));
    expect(h.app.workspace.openedLinks).toEqual([{ linktext: "Maps/Westmarch Sewers.map", sourcePath: MAP_PATH, newLeaf: "split" }]);
    expect(root.children).toEqual([]);
  });

  it("shows no popup for pins without maps", () => {
    harness().hooks.onHover?.(pin("Plain"), evt(), pinEl as unknown as HTMLElement);
    expect(root.children).toEqual([]);
  });

  it("titles actions 'Open map: <name>'", () => {
    expect(openMapTitle({ name: "X", path: "X.map" })).toBe("Open map: X");
  });
});

describe("has-map indicator", () => {
  class FakeEl {
    className = "";
    textContent: string | null = null;
    children: FakeEl[] = [];
    style = { setProperty: () => {} };
    appendChild(c: FakeEl): FakeEl {
      this.children.push(c);
      return c;
    }
    find(cls: string): FakeEl | undefined {
      if (this.className.split(" ").includes(cls)) return this;
      for (const c of this.children) {
        const hit = c.find(cls);
        if (hit) return hit;
      }
      return undefined;
    }
  }
  const doc = { createElement: () => new FakeEl() };
  const icons = { has: () => true, set: () => {} };
  const model = (features: Feature[]): MapDocument => ({ type: "mythical-map", version: 1, image: { path: "x.png", width: 8, height: 8 }, features });
  beforeEach(() => {
    featureLayers.length = 0;
  });

  it("adds the badge to pins whose view says hasMap, and updates when that changes", () => {
    const r = createFeatureRenderer({ name: "map" } as unknown as L.Map, { icons, ownerDocument: doc as unknown as Document });
    const html = () => ((r.layerFor("ppin0001") as unknown as MockFeatureLayer).options.icon as MockDivIcon).options.html as unknown as FakeEl;
    r.render(model([pin("Westmarch")]), { hasMap: () => true });
    expect(html().find("mythical-map-pin-map-badge")).toBeDefined();
    expect(html().className).toContain("mythical-map-pin-has-map");
    r.render(model([pin("Westmarch")]), { hasMap: () => false });
    expect(html().find("mythical-map-pin-map-badge")).toBeUndefined();
    r.render(model([pin("Westmarch")]));
    expect(html().className).not.toContain("has-map");
  });
});
