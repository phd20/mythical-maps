import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The mock module is what vitest aliases `obsidian` to; import it directly for its test helpers.
import { App, MockElement, TFile, WorkspaceLeaf, type Plugin as MockPlugin } from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "../src/obsidian/constants";
import { featureSummary, MapView } from "../src/obsidian/mapView";
import { parseMap } from "../src/core/parse";
import { stringifyMap } from "../src/core/serialize";

const MAPS_DIR = fileURLToPath(new URL("../test-vault/Maps/", import.meta.url));
const fixture = (name: string) => readFileSync(MAPS_DIR + name, "utf8");

interface Harness {
  app: App;
  view: MapView;
  load: (data: string) => void;
  content: MockElement;
}

function open(name = "Maps/test.map", data?: string): Harness {
  const app = new App();
  const view = new MapView(new WorkspaceLeaf(app) as never);
  const mock = view as unknown as { loadFile(file: TFile, data: string): void };
  const file = new TFile(name);
  const load = (text: string) => mock.loadFile(file, text);
  if (data !== undefined) load(data);
  return { app, view, load, content: view.contentEl as unknown as MockElement };
}

const INVALID_SCHEMA = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "Maps/x.png", width: 10, height: 10 },
  features: [{ id: "pbad0001", type: "pin", rank: "a0" }],
});

describe("plugin registration", () => {
  it("registers the map view and the .map extension in onload", async () => {
    const plugin = new MythicalMapsPlugin(new App() as never, manifest);
    await plugin.onload();
    const mock = plugin as unknown as MockPlugin;
    expect(MAP_EXTENSION).toBe("map");
    expect(VIEW_TYPE_MAP).toBe("mythical-map-view");
    expect(mock.extensions).toEqual({ map: VIEW_TYPE_MAP });
    const factory = mock.views[VIEW_TYPE_MAP];
    expect(factory).toBeTypeOf("function");
    expect(factory?.(new WorkspaceLeaf())).toBeInstanceOf(MapView);
  });
});

describe("MapView basics", () => {
  it("reports type, icon and the file basename", () => {
    const { view } = open("Maps/all-types.map", fixture("all-types.map"));
    expect(view.getViewType()).toBe(VIEW_TYPE_MAP);
    expect(view.getIcon()).toBe("map");
    expect(view.getDisplayText()).toBe("all-types");
  });

  it("adds the scoping class to contentEl", () => {
    const { content } = open("Maps/all-types.map", fixture("all-types.map"));
    expect(content.hasClass("mythical-map-view")).toBe(true);
  });
});

describe("valid map", () => {
  it("loads all-types into the ok state with a feature-count summary", () => {
    const { view, content } = open("Maps/all-types.map", fixture("all-types.map"));
    const state = view.mapState;
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(featureSummary(state.map)).toBe("3 pins · 1 label · 1 region · 1 path · 2 folders");
    const text = content.textContent;
    expect(text).toContain("3 pins · 1 label · 1 region · 1 path · 2 folders");
    expect(text).toContain("Maps/fixture-4k.png");
    expect(text).toContain("4096 × 3072");
  });

  it("getViewData returns canonical JSON", () => {
    const raw = fixture("all-types.map");
    const { view } = open("Maps/all-types.map", raw);
    const parsed = parseMap(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(view.getViewData()).toBe(stringifyMap(parsed.map));
    expect(view.getViewData()).not.toBe(raw);
  });

  it("save writes canonical JSON", async () => {
    const raw = fixture("all-types.map");
    const { app, view } = open("Maps/all-types.map", raw);
    await view.save();
    expect(app.vault.modified).toHaveLength(1);
    expect(app.vault.modified[0]?.data).toBe(view.getViewData());
  });
});

describe("error states", () => {
  const cases = [
    ["invalid-json.map", "json", "This map file isn't valid JSON"],
    ["not-mythical.map", "not-mythical", "Not a Mythical map"],
    ["future-version.map", "future-version", "Made with a newer Mythical Maps"],
  ] as const;

  for (const [name, kind, heading] of cases) {
    it(`${name} → ${kind} error, raw text kept, no write`, async () => {
      const raw = fixture(name);
      const { app, view, content } = open(`Maps/${name}`, raw);
      const state = view.mapState;
      expect(state.kind).toBe("error");
      if (state.kind !== "error") return;
      expect(state.failure.kind).toBe(kind);
      expect(state.raw).toBe(raw);

      const h = content.findAll((el) => el.tag === "h3")[0];
      expect(h?.text).toBe(heading);
      const items = content.findAll((el) => el.tag === "li").map((el) => el.text);
      expect(items.length).toBe(state.failure.issues.length);
      expect(items.length).toBeGreaterThan(0);

      expect(view.getViewData()).toBe(raw);
      await view.save();
      view.requestSave();
      await Promise.resolve();
      expect(app.vault.modified).toEqual([]);
    });
  }

  it("not-mythical explains the file was left untouched", () => {
    const { content } = open("Maps/not-mythical.map", fixture("not-mythical.map"));
    expect(content.textContent).toContain("left untouched");
  });

  it("future-version tells the user to upgrade", () => {
    const { content } = open("Maps/future-version.map", fixture("future-version.map"));
    expect(content.textContent).toMatch(/Upgrade the Mythical Maps plugin/);
  });

  it("schema errors → invalid, issues listed as path: message, no write", async () => {
    const { app, view, content } = open("Maps/bad.map", INVALID_SCHEMA);
    const state = view.mapState;
    expect(state.kind).toBe("error");
    if (state.kind !== "error") return;
    expect(state.failure.kind).toBe("invalid");
    expect(content.findAll((el) => el.tag === "h3")[0]?.text).toBe("This map has errors");
    const items = content.findAll((el) => el.tag === "li").map((el) => el.text);
    const expected = state.failure.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
    expect(items).toEqual(expected);
    expect(items.some((t) => t.startsWith("features."))).toBe(true);
    expect(view.getViewData()).toBe(INVALID_SCHEMA);
    await view.save();
    expect(app.vault.modified).toEqual([]);
  });
});

describe("transitions", () => {
  it("recovers from an error state when valid data arrives", async () => {
    const { app, view, load, content } = open("Maps/x.map", fixture("invalid-json.map"));
    expect(view.mapState.kind).toBe("error");
    load(fixture("all-types.map"));
    expect(view.mapState.kind).toBe("ok");
    expect(content.findAll((el) => el.hasClass("mythical-map-error"))).toEqual([]);
    expect(content.textContent).toContain("3 pins");
    await view.save();
    expect(app.vault.modified).toHaveLength(1);
  });

  it("an ok view that receives invalid data stops saving", async () => {
    const { app, view, load } = open("Maps/x.map", fixture("all-types.map"));
    load(fixture("not-mythical.map"));
    expect(view.mapState.kind).toBe("error");
    await view.save();
    expect(app.vault.modified).toEqual([]);
  });

  it("clear resets to empty and saves nothing", async () => {
    const { app, view, content } = open("Maps/x.map", fixture("all-types.map"));
    view.clear();
    expect(view.mapState.kind).toBe("empty");
    expect(content.children).toEqual([]);
    await view.save();
    expect(app.vault.modified).toEqual([]);
  });
});
