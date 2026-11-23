import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App as ObsidianApp, HoverParent } from "obsidian";
import { App, Menu, TFile } from "./mocks/obsidian";
import { featureLayers, type MockDivIcon, type MockFeatureLayer } from "./mocks/leaflet";
import type * as L from "leaflet";
import { createLinkInteractions, linkResolves, RELINK_TITLE, type LinkActionContext } from "../src/obsidian/linkActions";
import { registerBrokenLinks, REFRESH_DELAY } from "../src/obsidian/brokenLinks";
import { createFeatureRenderer } from "../src/ui/featureRenderer";
import type { Feature, MapDocument } from "../src/core/schema";

const MAP_PATH = "Maps/world.map";
const pin = (link?: string): Feature => ({ id: "ppin0001", type: "pin", rank: "a0", pos: [0, 0], ...(link ? { link } : {}) });
const evt = () => ({ button: 0, preventDefault() { (this as { prevented?: boolean }).prevented = true; } }) as unknown as MouseEvent;

function harness(notes: string[]) {
  const app = new App();
  const files = notes.map((p) => new TFile(p));
  app.metadataCache.getFirstLinkpathDest = (linkpath: string) => files.find((f) => f.basename === linkpath) ?? null;
  const relinked: Feature[] = [];
  const ctx: LinkActionContext = {
    app: app as unknown as ObsidianApp,
    hoverParent: { hoverPopover: null } as HoverParent,
    sourcePath: () => MAP_PATH,
    isEditing: () => false,
    onSelect: () => {},
    notify: () => {},
    relink: (f) => relinked.push(f),
  };
  return { app, hooks: createLinkInteractions(ctx), relinked };
}

describe("Relink… on broken pins", () => {
  it("offers Relink… in the context menu of a broken pin only, and runs it", () => {
    const original = Menu.prototype.showAtMouseEvent;
    const shown: Menu[] = [];
    Menu.prototype.showAtMouseEvent = function (this: Menu, e: unknown) {
      shown.push(this);
      return original.call(this, e);
    };
    try {
      const h = harness(["Rusty Flagon.md"]);
      const e = evt();
      h.hooks.onContextMenu?.(pin("Gone"), e);
      expect((e as unknown as { prevented?: boolean }).prevented).toBe(true);
      expect(shown[0]!.items.map((i) => i.title)).toEqual([RELINK_TITLE]);
      shown[0]!.items[0]!.clickHandler?.(evt());
      expect(h.relinked.map((f) => f.id)).toEqual(["ppin0001"]);
      const e2 = evt();
      h.hooks.onContextMenu?.(pin("Rusty Flagon"), e2);
      expect((e2 as unknown as { prevented?: boolean }).prevented).toBeUndefined();
    } finally {
      Menu.prototype.showAtMouseEvent = original;
    }
  });

  it("shows a hover popup with Relink… for a broken pin, none for a resolving or unlinked pin", () => {
    class FakeEl {
      children: FakeEl[] = [];
      listeners: Record<string, Array<(e: unknown) => void>> = {};
      style: Record<string, string> = {};
      className = "";
      textContent = "";
      ownerDocument = { createElement: () => new FakeEl() };
      addEventListener(t: string, fn: (e: unknown) => void): void {
        (this.listeners[t] ??= []).push(fn);
      }
      appendChild(c: FakeEl): FakeEl {
        this.children.push(c);
        return c;
      }
      remove(): void {}
      getBoundingClientRect() {
        return { left: 0, bottom: 0, top: 0 };
      }
      closest(): FakeEl | null {
        return root;
      }
    }
    const root = new FakeEl();
    const target = new FakeEl() as unknown as HTMLElement;
    const h = harness(["Rusty Flagon.md"]);
    h.hooks.onHover?.(pin("Rusty Flagon"), evt(), target);
    h.hooks.onHover?.(pin(), evt(), target);
    expect(root.children).toEqual([]);
    h.hooks.onHover?.(pin("Gone"), evt(), target);
    const popup = root.children[0]!;
    expect(popup.children.map((c) => c.textContent)).toEqual([RELINK_TITLE]);
    popup.children[0]!.listeners.click![0]!(evt());
    expect(h.relinked).toHaveLength(1);
  });

  it("does not offer Relink… when the context has no relink action", () => {
    const h = harness([]);
    const hooks = createLinkInteractions({
      app: h.app as unknown as ObsidianApp,
      hoverParent: { hoverPopover: null } as HoverParent,
      sourcePath: () => MAP_PATH,
      isEditing: () => false,
      onSelect: () => {},
      notify: () => {},
    });
    const e = evt();
    hooks.onContextMenu?.(pin("Gone"), e);
    expect((e as unknown as { prevented?: boolean }).prevented).toBeUndefined();
  });

  it("a link that stops resolving is only reported broken", () => {
    const app = new App();
    const file = new TFile("Inn.md");
    let present = true;
    app.metadataCache.getFirstLinkpathDest = () => (present ? file : null);
    const real = app as unknown as ObsidianApp;
    expect(linkResolves(real, "Inn", MAP_PATH)).toBe(true);
    present = false;
    expect(linkResolves(real, "Inn", MAP_PATH)).toBe(false);
    expect(app.vault.modified).toEqual([]);
  });
});

describe("broken badge", () => {
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

  it("draws the badge while the view says the pin is broken and removes it when it resolves", () => {
    const r = createFeatureRenderer({ name: "map" } as unknown as L.Map, { icons, ownerDocument: doc as unknown as Document });
    const html = () => ((r.layerFor("ppin0001") as unknown as MockFeatureLayer).options.icon as MockDivIcon).options.html as unknown as FakeEl;
    r.render(model([pin("Gone")]), { isBroken: () => true });
    expect(html().find("mythical-map-pin-broken-badge")).toBeDefined();
    expect(html().className).toContain("mythical-map-pin-broken");
    r.render(model([pin("Gone")]), { isBroken: () => false });
    expect(html().find("mythical-map-pin-broken-badge")).toBeUndefined();
    r.render(model([pin("Gone")]));
    expect(html().className).not.toContain("broken");
  });
});

describe("registerBrokenLinks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("re-renders open views (debounced) when a note is created, renamed or deleted", () => {
    const app = new App();
    const refreshed: number[] = [];
    const views = [{ refreshStyles: () => refreshed.push(1) }] as never;
    registerBrokenLinks({ registerEvent: () => {} }, app as unknown as ObsidianApp, () => views);
    app.metadataCache.trigger("changed", new TFile("New.md"));
    app.vault.trigger("rename", new TFile("B.md"), "A.md");
    app.vault.trigger("delete", new TFile("C.md"));
    app.metadataCache.trigger("deleted", new TFile("C.md"));
    expect(refreshed).toEqual([]);
    vi.advanceTimersByTime(REFRESH_DELAY);
    expect(refreshed).toEqual([1]);
    expect(app.vault.modified).toEqual([]);
  });
});
