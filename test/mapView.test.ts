import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The mock module is what vitest aliases `obsidian` to; import it directly for its test helpers.
import { App, Menu, MockElement, Modal, TFile, WorkspaceLeaf, type Plugin as MockPlugin } from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "../src/obsidian/constants";
import {
  CHOOSE_IMAGE_TEXT,
  featureSummary,
  MapView,
  SET_DEFAULT_VIEW_COMMAND_ID,
  SET_DEFAULT_VIEW_COMMAND_NAME,
} from "../src/obsidian/mapView";
import { ImageSuggestModal } from "../src/obsidian/imageSuggestModal";
import type { MapStore } from "../src/core/document";
import type { MapDocument, Viewport } from "../src/core/schema";
import { obsidianIcons } from "../src/ui/obsidianIcons";
import { parseMap } from "../src/core/parse";
import { stringifyMap } from "../src/core/serialize";
import type { BaseMapHandle, BaseMapOptions } from "../src/ui/baseMap";

/** A fake base map mount: records what MapView asked for, and refresh/destroy calls. */
interface FakeMount {
  parent: unknown;
  options: BaseMapOptions;
  refreshes: number;
  destroyed: number;
  /** Models passed to `render`, in order. */
  renders: MapDocument[];
  /** What the fake map reports as its live view; null = not sized yet. */
  viewport: Viewport | null;
}

const MAPS_DIR = fileURLToPath(new URL("../test-vault/Maps/", import.meta.url));
const fixture = (name: string) => readFileSync(MAPS_DIR + name, "utf8");

interface Harness {
  app: App;
  view: MapView;
  load: (data: string) => void;
  content: MockElement;
  mounts: FakeMount[];
}

function open(name = "Maps/test.map", data?: string, app = new App()): Harness {
  const view = new MapView(new WorkspaceLeaf(app) as never);
  const mounts: FakeMount[] = [];
  view.mountMap = (parent, options) => {
    const m: FakeMount = { parent, options, refreshes: 0, destroyed: 0, renders: [], viewport: { center: [-50, 60.5], zoom: 2.25 } };
    mounts.push(m);
    return {
      refresh: () => m.refreshes++,
      destroy: () => m.destroyed++,
      render: (model: MapDocument) => m.renders.push(model),
      currentViewport: () => m.viewport,
    } as unknown as BaseMapHandle;
  };
  const mock = view as unknown as { loadFile(file: TFile, data: string): void };
  const file = new TFile(name);
  const load = (text: string) => mock.loadFile(file, text);
  if (data !== undefined) load(data);
  return { app, view, load, content: view.contentEl as unknown as MockElement, mounts };
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

describe("base map lifecycle", () => {
  it("mounts the base map into contentEl with the image size; a missing image has no URL", () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.parent).toBe(view.contentEl);
    expect(mounts[0]?.options).toEqual({
      imageUrl: null,
      width: 4096,
      height: 3072,
      icons: obsidianIcons,
      viewport: { center: [-96, 128], zoom: 2 },
    });
    expect(view.mapHandle).not.toBeNull();
  });

  it("resolves the image through the vault to a resource URL", () => {
    const app = new App();
    const image = new TFile("Maps/fixture-4k.png");
    const vault = app.vault as unknown as {
      getFileByPath(p: string): TFile | null;
      getResourcePath(f: TFile): string;
    };
    vault.getFileByPath = (p) => (p === image.path ? image : null);
    vault.getResourcePath = (f) => `app://local/${f.path}`;
    const { mounts } = open("Maps/all-types.map", fixture("all-types.map"), app);
    expect(mounts[0]?.options.imageUrl).toBe("app://local/Maps/fixture-4k.png");
  });

  it("does not mount a map in an error state", () => {
    const { view, mounts } = open("Maps/bad.map", INVALID_SCHEMA);
    expect(mounts).toEqual([]);
    expect(view.mapHandle).toBeNull();
  });

  it("onResize refreshes the mounted map", () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    view.onResize();
    view.onResize();
    expect(mounts[0]?.refreshes).toBe(2);
  });

  it("tears down the previous map on re-render, error, clear and unload", () => {
    const { view, load, mounts } = open("Maps/x.map", fixture("all-types.map"));
    load(fixture("all-types.map"));
    expect(mounts.map((m) => m.destroyed)).toEqual([1, 0]);
    load(fixture("not-mythical.map"));
    expect(mounts.map((m) => m.destroyed)).toEqual([1, 1]);
    expect(view.mapHandle).toBeNull();
    load(fixture("all-types.map"));
    view.clear();
    expect(mounts.map((m) => m.destroyed)).toEqual([1, 1, 1]);
    load(fixture("all-types.map"));
    view.unload();
    expect(mounts.map((m) => m.destroyed)).toEqual([1, 1, 1, 1]);
    view.onResize();
    expect(mounts[3]?.refreshes).toBe(0);
  });
});

/** Make `paths` exist in the mock vault (getFileByPath / getFiles). */
function withFiles(app: App, paths: string[]): TFile[] {
  const files = paths.map((p) => new TFile(p));
  const vault = app.vault as unknown as { getFileByPath(p: string): TFile | null; getFiles(): TFile[] };
  vault.getFileByPath = (p) => files.find((f) => f.path === p) ?? null;
  vault.getFiles = () => files;
  return files;
}

const NO_VIEWPORT = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "Maps/fixture-4k.png", width: 4096, height: 3072 },
  features: [],
});

const savedViewport = (view: MapView): Viewport | undefined => {
  const state = view.mapState;
  return state.kind === "ok" ? state.map.viewport : undefined;
};

describe("opening viewport", () => {
  it("passes no viewport when the map has none (the base map fits the image)", () => {
    const { mounts } = open("Maps/x.map", NO_VIEWPORT);
    expect(mounts[0]?.options).toEqual({ imageUrl: null, width: 4096, height: 3072, icons: obsidianIcons });
  });
});

describe("Set current view as default", () => {
  it("saves the live centre and zoom as viewport, in canonical JSON", async () => {
    const { app, view } = open("Maps/x.map", NO_VIEWPORT);
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    expect(view.canSetDefaultView()).toBe(true);
    expect(view.setCurrentViewAsDefault()).toBe(true);
    await Promise.resolve();
    expect(savedViewport(view)).toEqual({ center: [-50, 60.5], zoom: 2.25 });
    expect(app.vault.modified).toHaveLength(1);
    const written = app.vault.modified[0]?.data ?? "";
    expect(written).toBe(view.getViewData());
    const reparsed = parseMap(written);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.map.viewport).toEqual({ center: [-50, 60.5], zoom: 2.25 });
    expect(stringifyMap(reparsed.map)).toBe(written);
    expect(notices).toHaveLength(1);
  });

  it("is unavailable before the map has a view, and in an error state", async () => {
    const { app, view, mounts } = open("Maps/x.map", NO_VIEWPORT);
    const mount = mounts[0];
    if (mount) mount.viewport = null;
    expect(view.canSetDefaultView()).toBe(false);
    expect(view.setCurrentViewAsDefault()).toBe(false);
    const bad = open("Maps/bad.map", INVALID_SCHEMA, app);
    expect(bad.view.canSetDefaultView()).toBe(false);
    expect(bad.view.setCurrentViewAsDefault()).toBe(false);
    await Promise.resolve();
    expect(app.vault.modified).toEqual([]);
  });

  it("is refused while the map is locked", async () => {
    const { app, view } = open("Maps/x.map", NO_VIEWPORT);
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    (view as unknown as { store: MapStore }).store.lock();
    expect(view.setCurrentViewAsDefault()).toBe(false);
    await Promise.resolve();
    expect(app.vault.modified).toEqual([]);
    expect(notices).toEqual(["Map is locked"]);
  });

  it("is offered in the pane menu only when available", () => {
    const { view, mounts } = open("Maps/x.map", NO_VIEWPORT);
    view.notify = () => {};
    const menu = new Menu();
    view.onPaneMenu(menu as never, "more-options");
    expect(menu.items.map((i) => i.title)).toEqual([SET_DEFAULT_VIEW_COMMAND_NAME]);
    menu.items[0]?.clickHandler?.({});
    expect(savedViewport(view)).toEqual({ center: [-50, 60.5], zoom: 2.25 });
    const mount = mounts[0];
    if (mount) mount.viewport = null;
    const empty = new Menu();
    view.onPaneMenu(empty as never, "more-options");
    expect(empty.items).toEqual([]);
  });

  it("is a command that checks for an active map view", async () => {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    await plugin.onload();
    const command = (plugin as unknown as MockPlugin).commands.find((c) => c.id === SET_DEFAULT_VIEW_COMMAND_ID);
    expect(command?.name).toBe(SET_DEFAULT_VIEW_COMMAND_NAME);
    expect(command?.checkCallback?.(true)).toBe(false);
    const { view } = open("Maps/x.map", NO_VIEWPORT, app);
    view.notify = () => {};
    (app.workspace as unknown as { activeView: unknown }).activeView = view;
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(savedViewport(view)).toBeUndefined();
    command?.checkCallback?.(false);
    expect(savedViewport(view)).toEqual({ center: [-50, 60.5], zoom: 2.25 });
  });
});

describe("missing image", () => {
  const notice = (content: MockElement) => content.findAll((el) => el.hasClass("mythical-map-missing-image"))[0];
  const chooseButton = (content: MockElement) => notice(content)?.findAll((el) => el.tag === "button")[0];

  it("shows the notice with a Choose image button, and still mounts the map", () => {
    const { content, mounts } = open("Maps/missing-image.map", fixture("missing-image.map"));
    expect(notice(content)?.textContent).toContain("Image not found: Maps/does-not-exist.png");
    expect(chooseButton(content)?.text).toBe(CHOOSE_IMAGE_TEXT);
    expect(mounts).toHaveLength(1);
  });

  it("shows no notice when the image resolves", () => {
    const app = new App();
    withFiles(app, ["Maps/fixture-4k.png"]);
    const { content } = open("Maps/all-types.map", fixture("all-types.map"), app);
    expect(notice(content)).toBeUndefined();
  });

  it("Choose image… opens a picker over the vault's images", () => {
    const app = new App();
    withFiles(app, ["Notes/a.md", "Maps/z.webp", "Maps/b.PNG", "Maps/x.map"]);
    const { content } = open("Maps/missing-image.map", fixture("missing-image.map"), app);
    Modal.opened.length = 0;
    chooseButton(content)?.click();
    const modal = Modal.opened[0];
    expect(modal).toBeInstanceOf(ImageSuggestModal);
    const picker = modal as unknown as ImageSuggestModal;
    expect(picker.getItems().map((f) => picker.getItemText(f))).toEqual(["Maps/b.PNG", "Maps/z.webp"]);
  });

  it("choosing an image updates image (path, width, height), saves and re-renders", async () => {
    const app = new App();
    const [image] = withFiles(app, ["Maps/new.png"]);
    const { view, content, mounts } = open("Maps/missing-image.map", fixture("missing-image.map"), app);
    const sizes: string[] = [];
    view.readImageSize = async (file) => {
      sizes.push(file.path);
      return { width: 2000.4, height: 1000 };
    };
    let chosen: Promise<boolean> | undefined;
    view.pickImage = (onChoose) => {
      const original = view.replaceImage.bind(view);
      view.replaceImage = (f) => (chosen = original(f));
      onChoose(image as never);
    };
    chooseButton(content)?.click();
    expect(await chosen).toBe(true);
    expect(sizes).toEqual(["Maps/new.png"]);
    const state = view.mapState;
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") return;
    expect(state.map.image).toEqual({ path: "Maps/new.png", width: 2000, height: 1000 });
    expect(state.map.features).toHaveLength(1);
    expect(app.vault.modified).toHaveLength(1);
    const written = parseMap(app.vault.modified[0]?.data ?? "");
    expect(written.ok && written.map.image).toEqual({ path: "Maps/new.png", width: 2000, height: 1000 });
    expect(mounts).toHaveLength(2);
    expect(mounts[0]?.destroyed).toBe(1);
    expect(mounts[1]?.options).toMatchObject({ imageUrl: "app://local/Maps/new.png", width: 2000, height: 1000 });
    expect(notice(content)).toBeUndefined();
  });

  it("an unreadable image changes nothing and tells the user", async () => {
    const { app, view } = open("Maps/missing-image.map", fixture("missing-image.map"));
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    view.readImageSize = async () => {
      throw new Error("decode failed");
    };
    const origError = console.error;
    console.error = () => {};
    try {
      expect(await view.replaceImage(new TFile("Maps/broken.png") as never)).toBe(false);
    } finally {
      console.error = origError;
    }
    view.readImageSize = async () => ({ width: 0, height: 0 });
    expect(await view.replaceImage(new TFile("Maps/empty.png") as never)).toBe(false);
    expect(notices).toEqual(["Could not read the size of Maps/broken.png.", "Could not read the size of Maps/empty.png."]);
    expect(app.vault.modified).toEqual([]);
    const state = view.mapState;
    expect(state.kind === "ok" && state.map.image.path).toBe("Maps/does-not-exist.png");
  });

  it("drops the result if the file was reloaded meanwhile, and never writes from an error state", async () => {
    const { app, view, load } = open("Maps/missing-image.map", fixture("missing-image.map"));
    let resolve: (s: { width: number; height: number }) => void = () => {};
    view.readImageSize = () => new Promise((r) => (resolve = r));
    const pending = view.replaceImage(new TFile("Maps/new.png") as never);
    load(fixture("not-mythical.map"));
    resolve({ width: 10, height: 10 });
    expect(await pending).toBe(false);
    expect(await view.replaceImage(new TFile("Maps/new.png") as never)).toBe(false);
    let picked = false;
    view.pickImage = () => {
      picked = true;
    };
    view.chooseImage();
    expect(picked).toBe(false);
    expect(app.vault.modified).toEqual([]);
  });
});

describe("feature rendering (bead 4.3)", () => {
  it("passes Obsidian icons and renders the store's map right after mount", () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    expect(mounts[0]?.options.icons).toBe(obsidianIcons);
    expect(mounts[0]?.renders).toHaveLength(1);
    const state = view.mapState;
    if (state.kind !== "ok") throw new Error("expected ok state");
    expect(mounts[0]?.renders[0]).toBe(state.map);
  });

  it("renders features on a map whose image is missing", () => {
    const { mounts } = open("Maps/missing-image.map", fixture("missing-image.map"));
    expect(mounts[0]?.options.imageUrl).toBeNull();
    expect(mounts[0]?.renders).toHaveLength(1);
  });

  it("re-renders on a store change", () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    expect(view.setCurrentViewAsDefault()).toBe(true);
    const renders = mounts[0]?.renders ?? [];
    expect(renders).toHaveLength(2);
    expect(renders[1]?.viewport).toEqual({ center: [-50, 60.5], zoom: 2.25 });
    expect(mounts).toHaveLength(1);
  });

  it("drops the old store's subscription on reload, clear and unload", () => {
    const { view, load, mounts } = open("Maps/x.map", fixture("all-types.map"));
    const oldStore = (view as unknown as { store: MapStore }).store;
    load(fixture("all-types.map"));
    oldStore.apply({ type: "setViewport", viewport: { center: [0, 0], zoom: 1 } });
    expect(mounts.map((m) => m.renders.length)).toEqual([1, 1]);
    view.clear();
    expect(mounts[1]?.destroyed).toBe(1);
    load(fixture("all-types.map"));
    const store = (view as unknown as { store: MapStore }).store;
    view.unload();
    store.apply({ type: "setViewport", viewport: { center: [0, 0], zoom: 1 } });
    expect(mounts[2]?.renders).toHaveLength(1);
    expect(mounts[2]?.destroyed).toBe(1);
  });
});

describe("live reload on external change (bead 4.5)", () => {
  /** all-types.map with one extra pin, as an external editor would write it. */
  const withNewPin = (raw = fixture("all-types.map"), image?: { path: string; width: number; height: number }) => {
    const json = JSON.parse(raw) as { image: unknown; features: unknown[] };
    json.features.push({ id: "pnew0001", type: "pin", name: "New", rank: "b0", pos: [-10, 10] });
    if (image) json.image = image;
    return JSON.stringify(json, null, 2);
  };
  const external = (view: MapView, data: string) =>
    (view as unknown as { modifyExternally(d: string): void }).modifyExternally(data);
  const storeOf = (view: MapView) => (view as unknown as { store: MapStore }).store;

  it("re-renders an unmodified map in place: no remount, new pin rendered, status updated", () => {
    const { view, content, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    const store = storeOf(view);
    external(view, withNewPin());
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.destroyed).toBe(0);
    const renders = mounts[0]?.renders ?? [];
    expect(renders).toHaveLength(2);
    expect(renders[1]?.features.some((f) => f.id === "pnew0001")).toBe(true);
    expect(storeOf(view)).toBe(store);
    expect(store.dirty).toBe(false);
    const state = view.mapState;
    expect(state.kind === "ok" && state.map).toBe(store.map);
    expect(content.textContent).toContain("4 pins");
    expect(content.findAll((el) => el.hasClass("mythical-map-status"))).toHaveLength(1);
  });

  it("keeps the lock across a reload and clears undo history", () => {
    const { view } = open("Maps/all-types.map", fixture("all-types.map"));
    const store = storeOf(view);
    store.lock();
    external(view, withNewPin());
    expect(store.isLocked).toBe(true);
    expect(store.map.features.some((f) => f.id === "pnew0001")).toBe(true);
    store.unlock();
    expect(store.canUndo).toBe(false);
  });

  it("ignores an echo of our own save", async () => {
    const { view, mounts } = open("Maps/x.map", NO_VIEWPORT);
    view.notify = () => {};
    view.setCurrentViewAsDefault();
    await Promise.resolve();
    view.setViewData(view.getViewData(), false);
    expect(mounts).toHaveLength(1);
    expect(mounts[0]?.renders).toHaveLength(2);
  });

  it("marks the store saved after a save, so later external edits reload", async () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    view.notify = () => {};
    view.setCurrentViewAsDefault();
    expect(storeOf(view).dirty).toBe(true);
    await view.save();
    expect(storeOf(view).dirty).toBe(false);
    external(view, withNewPin(view.getViewData()));
    expect(mounts).toHaveLength(1);
    const state = view.mapState;
    expect(state.kind === "ok" && state.map.features.some((f) => f.id === "pnew0001")).toBe(true);
    expect(state.kind === "ok" && state.map.viewport).toEqual({ center: [-50, 60.5], zoom: 2.25 });
  });

  it("keeps unsaved local edits and tells the user the file changed on disk", () => {
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    view.setCurrentViewAsDefault();
    // The debounced save has not run yet, so the store is still dirty.
    expect(storeOf(view).dirty).toBe(true);
    external(view, withNewPin());
    expect(notices.at(-1)).toMatch(/changed on disk/);
    const state = view.mapState;
    expect(state.kind === "ok" && state.map.features.some((f) => f.id === "pnew0001")).toBe(false);
    expect(state.kind === "ok" && state.map.viewport).toEqual({ center: [-50, 60.5], zoom: 2.25 });
    expect(mounts).toHaveLength(1);
  });

  it("an external edit that breaks the file shows the error state and never writes", async () => {
    const { app, view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    external(view, fixture("invalid-json.map"));
    expect(view.mapState.kind).toBe("error");
    expect(mounts[0]?.destroyed).toBe(1);
    await view.save();
    expect(app.vault.modified).toEqual([]);
    external(view, fixture("all-types.map"));
    expect(view.mapState.kind).toBe("ok");
    expect(mounts).toHaveLength(2);
  });

  it("remounts when the image changes, keeping the live view if the frame size is the same", () => {
    const app = new App();
    withFiles(app, ["Maps/fixture-4k.png", "Maps/other.png", "Maps/small.png"]);
    const vault = app.vault as unknown as { getResourcePath(f: TFile): string };
    vault.getResourcePath = (f) => `app://local/${f.path}`;
    const { view, mounts } = open("Maps/all-types.map", fixture("all-types.map"), app);
    external(view, withNewPin(undefined, { path: "Maps/other.png", width: 4096, height: 3072 }));
    expect(mounts).toHaveLength(2);
    expect(mounts[0]?.destroyed).toBe(1);
    expect(mounts[1]?.options).toMatchObject({
      imageUrl: "app://local/Maps/other.png",
      viewport: { center: [-50, 60.5], zoom: 2.25 },
    });
    expect(mounts[1]?.renders).toHaveLength(1);
    external(view, withNewPin(undefined, { path: "Maps/small.png", width: 100, height: 50 }));
    expect(mounts).toHaveLength(3);
    // A different frame falls back to the file's own viewport.
    expect(mounts[2]?.options.viewport).toEqual({ center: [-96, 128], zoom: 2 });
  });

  it("a clear=true load still remounts (a different file opened in the leaf)", () => {
    const { load, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    load(withNewPin());
    expect(mounts).toHaveLength(2);
  });
});
