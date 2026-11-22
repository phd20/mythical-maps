import { describe, expect, it } from "vitest";
import type { App as ObsidianApp, HoverParent } from "obsidian";
import { App, TFile } from "./mocks/obsidian";
import {
  createLinkInteractions,
  HOVER_SOURCE_ID,
  linkOf,
  linkResolves,
  registerLinkHoverSource,
  type LinkActionContext,
} from "../src/obsidian/linkActions";
import type { Feature } from "../src/core/schema";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";

const MAP_PATH = "Maps/westmarch.map";

/** An app whose resolver knows the given note paths by basename. */
function appWith(notes: string[]): App {
  const app = new App();
  const files = notes.map((p) => new TFile(p));
  app.metadataCache.getFirstLinkpathDest = (linkpath: string) =>
    files.find((f) => f.basename === linkpath || f.path === linkpath) ?? null;
  return app;
}

function harness(opts: { editing?: boolean; sourcePath?: string | null; notes?: string[] } = {}) {
  const app = appWith(opts.notes ?? ["Places/Rusty Flagon.md"]);
  const hoverParent: HoverParent = { hoverPopover: null };
  const selected: string[] = [];
  const notices: string[] = [];
  const hovers: unknown[] = [];
  const ws = app.workspace;
  ws.on("hover-link", (payload: unknown) => hovers.push(payload));
  const ctx: LinkActionContext = {
    app: app as unknown as ObsidianApp,
    hoverParent,
    sourcePath: () => (opts.sourcePath === undefined ? MAP_PATH : opts.sourcePath),
    isEditing: () => opts.editing ?? false,
    onSelect: (id) => selected.push(id),
    notify: (m) => notices.push(m),
  };
  const hooks = createLinkInteractions(ctx);
  return { app, hooks, hoverParent, selected, notices, hovers, opened: () => ws.openedLinks ?? [] };
}

const pin = (link?: string): Feature => ({ id: "ppin0001", type: "pin", rank: "a0", pos: [0, 0], ...(link ? { link } : {}) });
const region: Feature = { id: "rreg0001", type: "region", rank: "a1", polygon: [[0, 0], [0, 1], [1, 1]] };
const evt = (over: Partial<MouseEvent> = {}) => ({ button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }) as MouseEvent;
const el = { tag: "pin-el" } as unknown as HTMLElement;

describe("hover preview", () => {
  it("triggers hover-link with the source, parent, target, linktext and map path", () => {
    const h = harness();
    const event = evt();
    h.hooks.onHover?.(pin("Rusty Flagon#Rooms"), event, el);
    expect(h.hovers).toEqual([
      { event, source: HOVER_SOURCE_ID, hoverParent: h.hoverParent, targetEl: el, linktext: "Rusty Flagon#Rooms", sourcePath: MAP_PATH },
    ]);
  });

  it("does nothing for unlinked features, broken links or a view without a file", () => {
    for (const [h, f] of [
      [harness(), pin()],
      [harness(), region],
      [harness(), pin("Missing")],
      [harness(), pin("#Heading")],
      [harness({ sourcePath: null }), pin("Rusty Flagon")],
    ] as const) {
      h.hooks.onHover?.(f, evt(), el);
      expect(h.hovers).toEqual([]);
    }
  });

  it("still previews in edit modes (hover is not an edit)", () => {
    const h = harness({ editing: true });
    h.hooks.onHover?.(pin("Rusty Flagon"), evt(), el);
    expect(h.hovers).toHaveLength(1);
  });
});

describe("opening notes on click", () => {
  it("opens the note in the same tab on a plain click", () => {
    const h = harness();
    h.hooks.onClick?.(pin("Rusty Flagon"), evt());
    expect(h.opened()).toEqual([{ linktext: "Rusty Flagon", sourcePath: MAP_PATH, newLeaf: false }]);
  });

  it("passes Keymap.isModEvent's result for Mod, Mod+Alt and Mod+Alt+Shift clicks", () => {
    const h = harness();
    h.hooks.onClick?.(pin("Rusty Flagon"), evt({ metaKey: true }));
    h.hooks.onClick?.(pin("Rusty Flagon"), evt({ ctrlKey: true, altKey: true }));
    h.hooks.onClick?.(pin("Rusty Flagon"), evt({ ctrlKey: true, altKey: true, shiftKey: true }));
    expect(h.opened().map((o) => o.newLeaf)).toEqual(["tab", "split", "window"]);
  });

  it("selects instead of opening in edit modes, for any feature", () => {
    const h = harness({ editing: true });
    h.hooks.onClick?.(pin("Rusty Flagon"), evt({ metaKey: true }));
    h.hooks.onClick?.(region, evt());
    expect(h.selected).toEqual(["ppin0001", "rreg0001"]);
    expect(h.opened()).toEqual([]);
  });

  it("does nothing for unlinked features in view mode", () => {
    const h = harness();
    h.hooks.onClick?.(pin(), evt());
    h.hooks.onClick?.(region, evt());
    expect(h.opened()).toEqual([]);
    expect(h.selected).toEqual([]);
    expect(h.notices).toEqual([]);
  });

  it("shows a notice for a broken link instead of creating a note", () => {
    const h = harness();
    h.hooks.onClick?.(pin("Missing Note"), evt());
    expect(h.opened()).toEqual([]);
    expect(h.notices).toEqual(["Note not found: Missing Note"]);
  });
});

describe("helpers", () => {
  it("linkOf returns only pin links", () => {
    expect(linkOf(pin("A"))).toBe("A");
    expect(linkOf(pin())).toBeNull();
    expect(linkOf(region)).toBeNull();
  });

  it("linkResolves strips the subpath and refuses same-file subpaths", () => {
    const app = appWith(["Rusty Flagon.md"]);
    const real = app as unknown as ObsidianApp;
    expect(linkResolves(real, "Rusty Flagon#Rooms", MAP_PATH)).toBe(true);
    expect(linkResolves(real, "#Rooms", MAP_PATH)).toBe(false);
    expect(linkResolves(real, "Nope", MAP_PATH)).toBe(false);
  });

  it("registers the hover link source, also from the plugin's onload", async () => {
    const plugin = new MythicalMapsPlugin(new App() as never, manifest);
    registerLinkHoverSource(plugin);
    const sources = (plugin as unknown as { hoverLinkSources?: Record<string, unknown> }).hoverLinkSources;
    expect(sources?.[HOVER_SOURCE_ID]).toEqual({ display: "Mythical Maps", defaultMod: false });
    const loaded = new MythicalMapsPlugin(new App() as never, manifest);
    await loaded.onload();
    expect((loaded as unknown as { hoverLinkSources?: Record<string, unknown> }).hoverLinkSources?.[HOVER_SOURCE_ID]).toBeDefined();
  });
});
