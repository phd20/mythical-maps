import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// The mock module is what vitest aliases `obsidian` to; import it directly for its test helpers.
import {
  App,
  Menu,
  MockElement,
  Modal,
  Scope,
  Tasks,
  TFile,
  WorkspaceLeaf,
  type Plugin as MockPlugin,
} from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "../src/obsidian/constants";
import {
  CHOOSE_IMAGE_TEXT,
  featureSummary,
  isTextInputTarget,
  LOCK_TITLE,
  LOCKED_NOTICE,
  MapView,
  REDO_COMMAND_ID,
  SET_DEFAULT_VIEW_COMMAND_ID,
  SET_DEFAULT_VIEW_COMMAND_NAME,
  TOGGLE_LOCK_COMMAND_ID,
  UNDO_COMMAND_ID,
  UNLOCK_TITLE,
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
  /** The `RenderView` passed with each render, in order. */
  renderViews: unknown[];
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
    const m: FakeMount = {
      parent,
      options,
      refreshes: 0,
      destroyed: 0,
      renders: [],
      renderViews: [],
      viewport: { center: [-50, 60.5], zoom: 2.25 },
    };
    mounts.push(m);
    return {
      refresh: () => m.refreshes++,
      destroy: () => m.destroyed++,
      render: (model: MapDocument, renderView?: unknown) => {
        m.renders.push(model);
        m.renderViews.push(renderView);
      },
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

  it("save writes canonical JSON after an edit", async () => {
    const raw = fixture("all-types.map");
    const { app, view } = open("Maps/all-types.map", raw);
    view.requestSave = () => {};
    view.edit({ type: "insert", feature: { type: "pin", name: "New", pos: [-10, 10] } });
    await view.save();
    expect(app.vault.modified).toHaveLength(1);
    expect(app.vault.modified[0]?.data).toBe(view.getViewData());
  });

  it("never rewrites an unedited map, even one that is not canonical (mm-b1f.39)", async () => {
    const raw = fixture("all-types.map");
    const { app, view, load } = open("Maps/all-types.map", raw);
    await view.save();
    view.requestSave();
    await view.flush();
    // A reload from disk is not an edit either.
    view.setViewData(raw.replace("Westmarch", "Eastmarch"), false);
    await view.save();
    load(raw);
    await view.save(true);
    expect(app.vault.modified).toEqual([]);
    expect(view.mapState.kind).toBe("empty");
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
    view.requestSave = () => {};
    view.edit({ type: "insert", feature: { type: "pin", name: "New", pos: [-10, 10] } });
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
      interactions: expect.any(Object),
      pointer: expect.any(Object),
      geometry: expect.any(Object),
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
    expect(mounts[0]?.options).toEqual({
      imageUrl: null,
      width: 4096,
      height: 3072,
      icons: obsidianIcons,
      interactions: expect.any(Object),
      pointer: expect.any(Object),
      geometry: expect.any(Object),
    });
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
    view.setLocked(true);
    expect(view.setCurrentViewAsDefault()).toBe(false);
    await Promise.resolve();
    expect(app.vault.modified).toEqual([]);
    expect(notices).toEqual([LOCKED_NOTICE]);
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

describe("hover preview and opening notes (bead 6.2)", () => {
  const LINKED = JSON.stringify({
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/x.png", width: 10, height: 10 },
    features: [{ id: "ppin0001", type: "pin", rank: "a0", pos: [0, 0], link: "Rusty Flagon" }],
  });

  it("wires link interactions that resolve and open from the map file, and select in edit modes", () => {
    const app = new App();
    const note = new TFile("Places/Rusty Flagon.md");
    app.metadataCache.getFirstLinkpathDest = (p: string) => (p === "Rusty Flagon" ? note : null);
    const hovers: unknown[] = [];
    app.workspace.on("hover-link", (payload: unknown) => hovers.push(payload));
    const { view, mounts } = open("Maps/linked.map", LINKED, app);
    const hooks = mounts[0]?.options.interactions;
    const state = view.mapState;
    if (!hooks || state.kind !== "ok") throw new Error("no interactions");
    const feature = state.map.features[0]!;
    const evt = { ctrlKey: true } as MouseEvent;
    view.setLocked(true); // unlocked views are in an edit mode, where a click selects
    hooks.onHover?.(feature, evt, null);
    expect(hovers).toMatchObject([{ hoverParent: view, linktext: "Rusty Flagon", sourcePath: "Maps/linked.map" }]);
    hooks.onClick?.(feature, evt);
    expect(app.workspace.openedLinks).toEqual([{ linktext: "Rusty Flagon", sourcePath: "Maps/linked.map", newLeaf: "tab" }]);
    const selected: string[] = [];
    view.isEditing = () => true;
    view.selectFeature = (id) => selected.push(id);
    hooks.onClick?.(feature, evt);
    expect(selected).toEqual(["ppin0001"]);
    expect(app.workspace.openedLinks).toHaveLength(1);
  });
});

describe("document store wiring (bead 5.1)", () => {
  const storeOf = (view: MapView) => view.mapStore as MapStore;
  const pinIds = (view: MapView) => {
    const state = view.mapState;
    return state.kind === "ok" ? state.map.features.filter((f) => f.type === "pin").map((f) => f.id) : [];
  };
  /** Stop the mock's immediate save, so edits stay pending like Obsidian's debounced save. */
  const debounced = (view: MapView) => {
    let requests = 0;
    view.requestSave = () => {
      requests++;
    };
    return () => requests;
  };
  const lastWritten = (app: App) => {
    const parsed = parseMap(app.vault.modified.at(-1)?.data ?? "");
    if (!parsed.ok) throw new Error("expected a valid written map");
    return parsed.map;
  };

  it("edit applies the op through the store, saves canonical JSON and returns the new id", async () => {
    const { app, view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    const result = view.edit({ type: "insert", feature: { type: "pin", name: "New", pos: [-10, 10] } });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.id) throw new Error("expected an id");
    expect(pinIds(view)).toContain(result.id);
    expect(mounts[0]?.renders.at(-1)).toBe(storeOf(view).map);
    await Promise.resolve();
    expect(app.vault.modified).toHaveLength(1);
    expect(app.vault.modified[0]?.data).toBe(stringifyMap(storeOf(view).map));
    expect(lastWritten(app).features.some((f) => f.id === result.id)).toBe(true);
  });

  it("locked drag: the edit is refused with a notice, the pin snaps back, nothing is written", async () => {
    const { app, view, mounts } = open("Maps/all-types.map", fixture("all-types.map"));
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    view.setLocked(true);
    const before = storeOf(view).map;
    const result = view.edit({ type: "update", id: "pwestm01", patch: { pos: [0, 0] } });
    expect(result).toEqual({ ok: false, error: "Map is locked" });
    expect(notices).toEqual([LOCKED_NOTICE]);
    expect(storeOf(view).map).toBe(before);
    // Re-rendering the unchanged model puts a dragged marker back where the model says.
    expect(mounts[0]?.renders.at(-1)).toBe(before);
    await Promise.resolve();
    await view.flush();
    expect(app.vault.modified).toEqual([]);
  });

  it("an invalid op shows its error and changes nothing; edits outside the ok state are refused", async () => {
    const { app, view } = open("Maps/all-types.map", fixture("all-types.map"));
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    const result = view.edit({ type: "delete", id: "nope0000" });
    expect(result.ok).toBe(false);
    expect(notices).toHaveLength(1);
    const bad = open("Maps/bad.map", INVALID_SCHEMA, app);
    expect(bad.view.edit({ type: "setViewport", viewport: undefined }).ok).toBe(false);
    expect(bad.view.undo()).toBe(false);
    await Promise.resolve();
    expect(app.vault.modified).toEqual([]);
  });

  it("undo delete: the pin comes back with its id and properties, and is saved; redo deletes it again", async () => {
    const { app, view } = open("Maps/all-types.map", fixture("all-types.map"));
    const original = storeOf(view).map.features.find((f) => f.id === "pwestm01");
    expect(view.edit({ type: "delete", id: "pwestm01" }).ok).toBe(true);
    await Promise.resolve();
    expect(lastWritten(app).features.some((f) => f.id === "pwestm01")).toBe(false);
    expect(view.canUndo).toBe(true);
    expect(view.undo()).toBe(true);
    await Promise.resolve();
    expect(app.vault.modified).toHaveLength(2);
    expect(lastWritten(app).features.find((f) => f.id === "pwestm01")).toEqual(original);
    expect(view.canRedo).toBe(true);
    expect(view.redo()).toBe(true);
    await Promise.resolve();
    expect(app.vault.modified).toHaveLength(3);
    expect(lastWritten(app).features.some((f) => f.id === "pwestm01")).toBe(false);
    expect(view.redo()).toBe(false);
  });

  it("undo and redo are refused while locked, with a notice", () => {
    const { view } = open("Maps/all-types.map", fixture("all-types.map"));
    const notices: string[] = [];
    view.notify = (m) => notices.push(m);
    view.edit({ type: "delete", id: "pwestm01" });
    view.setLocked(true);
    expect(view.undo()).toBe(false);
    expect(view.redo()).toBe(false);
    expect(notices).toEqual([LOCKED_NOTICE, LOCKED_NOTICE]);
    expect(pinIds(view)).not.toContain("pwestm01");
    view.setLocked(false);
    expect(view.undo()).toBe(true);
    expect(pinIds(view)).toContain("pwestm01");
  });

  it("binds Mod+Z and Mod+Shift+Z in the view's own scope, leaving text fields alone", () => {
    const { app, view } = open("Maps/all-types.map", fixture("all-types.map"));
    const scope = view.scope as unknown as Scope;
    expect(scope).toBeInstanceOf(Scope);
    expect(scope.parent).toBe(app.scope);
    view.edit({ type: "delete", id: "pwestm01" });
    expect(scope.trigger(["Mod"], "z", { target: { tagName: "input" } })).toBe(true);
    expect(pinIds(view)).not.toContain("pwestm01");
    expect(scope.trigger(["Mod"], "z", { target: { tagName: "DIV" } })).toBe(false);
    expect(pinIds(view)).toContain("pwestm01");
    expect(scope.trigger(["Mod", "Shift"], "z", { target: { isContentEditable: true } })).toBe(true);
    expect(pinIds(view)).toContain("pwestm01");
    expect(scope.trigger(["Mod", "Shift"], "z", {})).toBe(false);
    expect(pinIds(view)).not.toContain("pwestm01");
  });

  it("isTextInputTarget recognises inputs, textareas, selects and contenteditable", () => {
    expect(isTextInputTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextInputTarget({ tagName: "select" })).toBe(true);
    expect(isTextInputTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTextInputTarget({ tagName: "DIV" })).toBe(false);
    expect(isTextInputTarget(null)).toBe(false);
    expect(isTextInputTarget("input")).toBe(false);
  });

  it("the header lock action toggles the lock and reflects it; maps open unlocked and the lock is never saved", async () => {
    const { app, view, load, content } = open("Maps/all-types.map", fixture("all-types.map"));
    view.load();
    const actions = (view as unknown as { actions: Array<{ callback: (e: unknown) => unknown; el: MockElement }> })
      .actions;
    expect(actions).toHaveLength(2); // lock, then "Show map panel"
    const action = actions[0];
    if (!action) throw new Error("expected a lock action");
    expect(view.isLocked).toBe(false);
    expect(action.el.icon).toBe("lock-open");
    expect(action.el.attributes["aria-label"]).toBe(LOCK_TITLE);
    action.callback({});
    expect(view.isLocked).toBe(true);
    expect(storeOf(view).isLocked).toBe(true);
    expect(action.el.icon).toBe("lock");
    expect(action.el.attributes["aria-label"]).toBe(UNLOCK_TITLE);
    expect(content.hasClass("is-locked")).toBe(true);
    // A different file opened in the same view gets a new store, still locked.
    load(fixture("all-types.map"));
    expect(storeOf(view).isLocked).toBe(true);
    action.callback({});
    expect(storeOf(view).isLocked).toBe(false);
    expect(content.hasClass("is-locked")).toBe(false);
    // Lock again after an edit: the saved file holds no lock state.
    view.edit({ type: "insert", feature: { type: "pin", name: "New", pos: [-10, 10] } });
    action.callback({});
    await view.save();
    expect(app.vault.modified.at(-1)?.data).not.toMatch(/lock/i);
  });

  it("close right after edit: onUnloadFile and onClose write the pending edit before the debounced save", async () => {
    const { app, view } = open("Maps/all-types.map", fixture("all-types.map"));
    const requests = debounced(view);
    view.edit({ type: "update", id: "pwestm01", patch: { pos: [-1, 2] } });
    expect(requests()).toBe(1);
    expect(app.vault.modified).toEqual([]);
    const file = view.file as TFile;
    await view.onUnloadFile(file as never);
    expect(app.vault.modified).toHaveLength(1);
    expect(lastWritten(app).features.find((f) => f.id === "pwestm01")).toMatchObject({ pos: [-1, 2] });
    expect((view as unknown as { unloadedFiles: TFile[] }).unloadedFiles).toEqual([file]);
    expect(storeOf(view).dirty).toBe(false);
    // Clean: closing writes nothing more.
    await view.onClose();
    expect(app.vault.modified).toHaveLength(1);
    view.edit({ type: "update", id: "pwestm01", patch: { pos: [-3, 4] } });
    await view.onClose();
    expect(app.vault.modified).toHaveLength(2);
    expect(lastWritten(app).features.find((f) => f.id === "pwestm01")).toMatchObject({ pos: [-3, 4] });
  });

  it("flushes on Obsidian's quit event and on unload; never from an error state", async () => {
    const { app, view } = open("Maps/all-types.map", fixture("all-types.map"));
    debounced(view);
    view.load();
    view.edit({ type: "update", id: "pwestm01", patch: { pos: [-5, 6] } });
    const tasks = new Tasks();
    (app.workspace as unknown as { trigger(name: string, ...args: unknown[]): void }).trigger("quit", tasks);
    await Promise.all(tasks.promises);
    expect(app.vault.modified).toHaveLength(1);
    view.edit({ type: "update", id: "pwestm01", patch: { pos: [-7, 8] } });
    view.unload();
    await Promise.resolve();
    expect(app.vault.modified).toHaveLength(2);
    expect(lastWritten(app).features.find((f) => f.id === "pwestm01")).toMatchObject({ pos: [-7, 8] });

    const bad = open("Maps/bad.map", INVALID_SCHEMA, app);
    await bad.view.flush();
    await bad.view.onUnloadFile(bad.view.file as never);
    bad.view.unload();
    await Promise.resolve();
    expect(app.vault.modified).toHaveLength(2);
  });

  it("renders with the style source after edits, refusals, undo and live reload, and remounts keep interactions", async () => {
    const app = new App();
    withFiles(app, ["Maps/fixture-4k.png", "Maps/other.png"]);
    const { view, mounts } = open("Maps/all-types.map", undefined, app);
    const styled = { styled: true } as never;
    view.styleSource = () => styled;
    (view as unknown as { loadFile(f: TFile, d: string): void }).loadFile(
      new TFile("Maps/all-types.map"),
      fixture("all-types.map"),
    );
    view.notify = () => {};
    const mount = () => mounts.at(-1);
    view.edit({ type: "delete", id: "pwestm01" });
    expect(mount()?.renderViews.at(-1)).toMatchObject(styled);
    view.undo();
    expect(mount()?.renderViews.at(-1)).toMatchObject(styled);
    view.setLocked(true);
    view.edit({ type: "delete", id: "pwestm01" });
    expect(mount()?.renderViews.at(-1)).toMatchObject(styled);
    view.setLocked(false);
    // Let the pending saves finish so the store is clean and the external edit reloads.
    await view.save();
    const json = JSON.parse(fixture("all-types.map")) as { image: unknown };
    json.image = { path: "Maps/other.png", width: 4096, height: 3072 };
    (view as unknown as { modifyExternally(d: string): void }).modifyExternally(JSON.stringify(json));
    expect(mounts.length).toBeGreaterThan(1);
    expect(mount()?.renderViews.at(-1)).toMatchObject(styled);
    expect(mount()?.options.interactions).toBeDefined();
    expect(mount()?.renderViews.every((v) => (v as { styled?: boolean }).styled === true)).toBe(true);
  });

  it("undoing an image change remounts the base map on the old image", async () => {
    const app = new App();
    const [image] = withFiles(app, ["Maps/new.png"]);
    const { view, mounts } = open("Maps/missing-image.map", fixture("missing-image.map"), app);
    view.readImageSize = async () => ({ width: 2000, height: 1000 });
    expect(await view.replaceImage(image as never)).toBe(true);
    expect(mounts).toHaveLength(2);
    expect(view.undo()).toBe(true);
    expect(mounts).toHaveLength(3);
    expect(mounts[2]?.options.imageUrl).toBeNull();
    const state = view.mapState;
    expect(state.kind === "ok" && state.map.image.path).toBe("Maps/does-not-exist.png");
  });
});

describe("map edit commands (bead 5.1)", () => {
  it("undo, redo and lock commands act on the active map view only when available", async () => {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    await plugin.onload();
    const commands = (plugin as unknown as MockPlugin).commands;
    const command = (id: string) => commands.find((c) => c.id === id);
    const undo = command(UNDO_COMMAND_ID);
    const redo = command(REDO_COMMAND_ID);
    const lock = command(TOGGLE_LOCK_COMMAND_ID);
    expect([undo?.name, redo?.name, lock?.name]).toEqual(["Undo map edit", "Redo map edit", "Toggle map lock"]);
    expect(undo?.checkCallback?.(true)).toBe(false);
    expect(lock?.checkCallback?.(true)).toBe(false);
    const { view } = open("Maps/all-types.map", fixture("all-types.map"), app);
    view.notify = () => {};
    (app.workspace as unknown as { activeView: unknown }).activeView = view;
    expect(undo?.checkCallback?.(true)).toBe(false);
    view.edit({ type: "delete", id: "pwestm01" });
    expect(undo?.checkCallback?.(true)).toBe(true);
    expect(redo?.checkCallback?.(true)).toBe(false);
    undo?.checkCallback?.(false);
    expect(view.canRedo).toBe(true);
    redo?.checkCallback?.(false);
    expect(view.canRedo).toBe(false);
    expect(lock?.checkCallback?.(true)).toBe(true);
    lock?.checkCallback?.(false);
    expect(view.isLocked).toBe(true);
    expect(undo?.checkCallback?.(true)).toBe(false);
  });
});
