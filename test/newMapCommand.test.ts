import { afterEach, describe, expect, it, vi } from "vitest";
import type { TFile as ObsidianTFile } from "obsidian";
import { App, Menu, Notice, TFile, type Command } from "./mocks/obsidian";
import { parseMap } from "../src/core/parse";
import {
  NEW_MAP_COMMAND_ID,
  NEW_MAP_COMMAND_NAME,
  createMapFromImage,
  createObsidianNewMapDeps,
  isImageFile,
  registerNewMapFromImage,
  type NewMapDeps,
} from "../src/obsidian/newMapCommand";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";

/** A vault holding `existing` paths; records creates and opens. */
function fakeDeps(existing: string[] = [], size = { width: 8192, height: 6144 }) {
  const files = new Set(existing);
  const created: Array<{ path: string; data: string }> = [];
  const opened: string[] = [];
  const notices: string[] = [];
  const deps: NewMapDeps = {
    exists: (p) => files.has(p),
    readImageSize: async () => size,
    create: async (path, data) => {
      files.add(path);
      created.push({ path, data });
      return new TFile(path) as never;
    },
    open: async (file) => {
      opened.push(file.path);
    },
    notify: (m) => notices.push(m),
  };
  return { deps, created, opened, notices };
}

/** A mock TFile typed as the real one (vitest aliases `obsidian` to the mock, so `instanceof` holds). */
const image = (path: string) => new TFile(path) as never as ObsidianTFile;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isImageFile", () => {
  it("accepts image files, case-insensitively, and nothing else", () => {
    expect(isImageFile(image("Maps/a.webp"))).toBe(true);
    expect(isImageFile(image("Maps/a.PNG"))).toBe(true);
    expect(isImageFile(image("Maps/a.jpeg"))).toBe(true);
    expect(isImageFile(image("Maps/a.md"))).toBe(false);
    expect(isImageFile(image("Maps/a.map"))).toBe(false);
    expect(isImageFile({ path: "Maps/a.png", extension: "png" })).toBe(false); // not a TFile (e.g. a folder)
    expect(isImageFile(null)).toBe(false);
  });
});

describe("createMapFromImage", () => {
  it("creates <basename>.map next to the image with the pixel size and opens it (spec: Create from image)", async () => {
    const { deps, created, opened } = fakeDeps();
    const file = await createMapFromImage(image("Maps/westmarch.webp"), deps);
    expect(file?.path).toBe("Maps/westmarch.map");
    expect(created).toHaveLength(1);
    const parsed = parseMap(created[0]!.data);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.map.image).toEqual({ path: "Maps/westmarch.webp", width: 8192, height: 6144 });
    expect(parsed.map.features).toEqual([]);
    expect(parsed.map.viewport).toEqual({ center: [-96, 128], zoom: 0 });
    expect(opened).toEqual(["Maps/westmarch.map"]);
  });

  it("writes canonical JSON", async () => {
    const { deps, created } = fakeDeps();
    await createMapFromImage(image("Maps/westmarch.webp"), deps);
    expect(created[0]!.data).toBe(
      [
        "{",
        '  "type": "mythical-map",',
        '  "version": 1,',
        '  "image": {',
        '    "path": "Maps/westmarch.webp",',
        '    "width": 8192,',
        '    "height": 6144',
        "  },",
        '  "viewport": {',
        '    "center": [-96, 128],',
        '    "zoom": 0',
        "  },",
        '  "features": []',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("adds a numeric suffix when the name is taken and leaves the existing file alone (spec: Name taken)", async () => {
    const { deps, created } = fakeDeps(["Maps/westmarch.map", "Maps/westmarch 1.map"]);
    const file = await createMapFromImage(image("Maps/westmarch.webp"), deps);
    expect(file?.path).toBe("Maps/westmarch 2.map");
    expect(created.map((c) => c.path)).toEqual(["Maps/westmarch 2.map"]);
  });

  it("shows a notice and creates nothing when the size can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, created, notices } = fakeDeps();
    deps.readImageSize = async () => {
      throw new Error("decode failed");
    };
    expect(await createMapFromImage(image("Maps/bad.png"), deps)).toBeNull();
    expect(created).toEqual([]);
    expect(notices).toEqual(["Could not read the size of Maps/bad.png."]);
  });

  it("treats a zero size as unreadable", async () => {
    const { deps, created, notices } = fakeDeps([], { width: 0, height: 0 });
    expect(await createMapFromImage(image("Maps/empty.svg"), deps)).toBeNull();
    expect(created).toEqual([]);
    expect(notices).toHaveLength(1);
  });

  it("shows a notice when the file can't be created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, notices, opened } = fakeDeps();
    deps.create = async () => {
      throw new Error("disk full");
    };
    expect(await createMapFromImage(image("Maps/westmarch.webp"), deps)).toBeNull();
    expect(notices).toEqual(["Could not create Maps/westmarch.map."]);
    expect(opened).toEqual([]);
  });
});

describe("registerNewMapFromImage", () => {
  function setup() {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    const { deps, created } = fakeDeps();
    registerNewMapFromImage(plugin, app as never, deps);
    const mock = plugin as unknown as { commands: Command[]; events: Array<{ name: string; owner: unknown }> };
    return { app, mock, created };
  }

  it("registers a command available only when the active file is an image", async () => {
    const { app, mock, created } = setup();
    const command = mock.commands.find((c) => c.id === NEW_MAP_COMMAND_ID);
    expect(command?.name).toBe(NEW_MAP_COMMAND_NAME);
    expect(command?.checkCallback?.(true)).toBe(false);
    app.workspace.activeFile = new TFile("Notes/a.md");
    expect(command?.checkCallback?.(true)).toBe(false);
    app.workspace.activeFile = new TFile("Maps/westmarch.webp");
    expect(command?.checkCallback?.(true)).toBe(true);
    expect(created).toEqual([]); // checking does nothing
    command?.checkCallback?.(false);
    await vi.waitFor(() => expect(created.map((c) => c.path)).toEqual(["Maps/westmarch.map"]));
  });

  it("adds a file-menu item on images only", async () => {
    const { app, mock, created } = setup();
    expect(mock.events.some((e) => e.name === "file-menu" && e.owner === app.workspace)).toBe(true);

    const noteMenu = new Menu();
    app.workspace.trigger("file-menu", noteMenu, new TFile("Notes/a.md"), "file-explorer");
    expect(noteMenu.items).toEqual([]);

    const menu = new Menu();
    app.workspace.trigger("file-menu", menu, new TFile("Maps/westmarch.webp"), "file-explorer");
    expect(menu.items.map((i) => i.title)).toEqual([NEW_MAP_COMMAND_NAME]);
    void menu.items[0]!.clickHandler?.(undefined);
    await vi.waitFor(() => expect(created.map((c) => c.path)).toEqual(["Maps/westmarch.map"]));
  });
});

describe("createObsidianNewMapDeps", () => {
  it("creates through the vault, checks existence against it and opens in a leaf", async () => {
    const app = new App();
    const deps = createObsidianNewMapDeps(app as never);
    expect(deps.exists("Maps/westmarch.map")).toBe(false);
    const file = await deps.create("Maps/westmarch.map", "{}\n");
    expect(deps.exists("Maps/westmarch.map")).toBe(true);
    expect(app.vault.created.map((c) => c.data)).toEqual(["{}\n"]);
    await deps.open(file);
    expect(app.workspace.leaves.flatMap((l) => l.opened.map((f) => f.path))).toEqual(["Maps/westmarch.map"]);
    expect(() => deps.notify("hi")).not.toThrow();
    expect(new Notice("x").message).toBe("x");
  });
});
