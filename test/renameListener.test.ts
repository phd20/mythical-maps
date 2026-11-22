import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, Plugin, TAbstractFile } from "obsidian";
import { parseMap } from "../src/core/parse";
import { stringifyMap } from "../src/core/serialize";
import type { MapDocument } from "../src/core/schema";
import { VaultMapIndex, type VaultMapIndexDeps } from "../src/obsidian/vaultMapIndex";
import { createRenameHandler, type RenameHandlerDeps } from "../src/obsidian/renameListener";

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const stripMd = (path: string): string => (path.endsWith(".md") ? path.slice(0, -3) : path);

/**
 * In-memory vault. Links resolve like wikilinks: by exact path (with or
 * without `.md`) first, then by unique-ish basename. `process` mimics
 * `vault.process`: it reads the current text and stores what `fn` returns.
 */
class FakeVault implements VaultMapIndexDeps {
  files = new Map<string, string>();
  processed: string[] = [];
  failOn = new Set<string>();

  listMapFiles(): string[] {
    return [...this.files.keys()].filter((p) => p.endsWith(".map"));
  }

  async read(path: string): Promise<string> {
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  }

  resolve(linktext: string): string | null {
    for (const path of this.files.keys()) if (path === linktext || path === `${linktext}.md`) return path;
    for (const path of this.files.keys()) {
      const base = basename(path);
      if (base === `${linktext}.md` || base === linktext) return path;
    }
    return null;
  }

  resolver = { resolve: (linktext: string): string | null => this.resolve(linktext) };

  move(from: string, to: string): void {
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`missing ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
  }

  renameDeps(index: VaultMapIndex): RenameHandlerDeps {
    return {
      index,
      process: async (mapPath, fn) => {
        await Promise.resolve();
        this.processed.push(mapPath);
        if (this.failOn.has(mapPath)) throw new Error(`disk error on ${mapPath}`);
        const text = this.files.get(mapPath);
        if (text === undefined) return;
        this.files.set(mapPath, fn(text));
      },
      // Shortest linktext: the basename when unique, else the full path (`.md` omitted).
      linktextFor: (newPath) => {
        const base = basename(newPath);
        const unique = [...this.files.keys()].filter((p) => basename(p) === base).length === 1;
        return stripMd(unique ? base : newPath);
      },
      resolveNow: this.resolver,
    };
  }
}

type Pin = { id: string; link?: string };

/** Compact (non-canonical) map text, so an untouched file is distinguishable from a rewritten one. */
function mapText(image: string, pins: Pin[]): string {
  return JSON.stringify({
    type: "mythical-map",
    version: 1,
    image: { path: image, width: 4096, height: 3072 },
    features: pins.map((p, i) => ({ id: p.id, type: "pin", rank: `a${i}`, pos: [-96, 128], ...(p.link ? { link: p.link } : {}) })),
  });
}

function parsed(text: string): MapDocument {
  const r = parseMap(text);
  if (!r.ok) throw new Error("fixture does not parse");
  return r.map;
}

/** The canonical text of `text`'s map after `edit`. */
function expected(text: string, edit: (map: MapDocument) => MapDocument): string {
  return stringifyMap(edit(parsed(text)));
}

function withLinks(map: MapDocument, links: Record<string, string>): MapDocument {
  return {
    ...map,
    features: map.features.map((f) => (f.type === "pin" && f.id in links ? { ...f, link: links[f.id] } : f)),
  };
}

function fixtureVault(): FakeVault {
  const v = new FakeVault();
  v.files.set("Places/Westmarch.md", "# Westmarch");
  v.files.set("Places/Rusty Flagon.md", "# Rusty Flagon");
  v.files.set("Places/The Keep.md", "# The Keep");
  v.files.set("Maps/westmarch.webp", "");
  v.files.set("Maps/other.png", "");
  v.files.set(
    "Maps/town.map",
    mapText("Maps/westmarch.webp", [
      { id: "pflag001", link: "Rusty Flagon" },
      { id: "pflag002", link: "Rusty Flagon#Cellar" },
      { id: "pwest001", link: "Westmarch" },
    ]),
  );
  v.files.set(
    "Maps/region.map",
    mapText("Maps/westmarch.webp", [
      { id: "pflag003", link: "Places/Rusty Flagon" },
      { id: "pkeep001", link: "Places/The Keep#Gate" },
    ]),
  );
  v.files.set("Maps/elsewhere.map", mapText("Maps/other.png", [{ id: "pwest002", link: "Westmarch" }]));
  v.files.set("Maps/invalid.map", "{ not json");
  return v;
}

async function setup(v = fixtureVault()) {
  const index = new VaultMapIndex(v);
  await index.build();
  const handler = createRenameHandler(v.renameDeps(index));
  return { v, index, handler };
}

afterEach(() => vi.restoreAllMocks());

describe("createRenameHandler", () => {
  it("rewrites every map linking a renamed note to the new linktext, keeping subpaths", async () => {
    const { v, handler } = await setup();
    const town = v.files.get("Maps/town.map")!;
    const region = v.files.get("Maps/region.map")!;
    const elsewhere = v.files.get("Maps/elsewhere.map")!;

    v.move("Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    await handler({ path: "Places/The Rusty Flagon.md" }, "Places/Rusty Flagon.md");

    expect(v.processed.sort()).toEqual(["Maps/region.map", "Maps/town.map"]);
    expect(v.files.get("Maps/town.map")).toBe(
      expected(town, (m) => withLinks(m, { pflag001: "The Rusty Flagon", pflag002: "The Rusty Flagon#Cellar" })),
    );
    expect(v.files.get("Maps/region.map")).toBe(expected(region, (m) => withLinks(m, { pflag003: "The Rusty Flagon" })));
    // A map that does not reference the note keeps byte-identical text.
    expect(v.files.get("Maps/elsewhere.map")).toBe(elsewhere);

    // The rewritten links resolve again.
    for (const mapPath of ["Maps/town.map", "Maps/region.map"]) {
      for (const f of parsed(v.files.get(mapPath)!).features) {
        if (f.type === "pin" && f.link?.includes("Flagon")) {
          expect(v.resolve(f.link.split("#")[0]!)).toBe("Places/The Rusty Flagon.md");
        }
      }
    }
  });

  it("updates image.path when the image moves, and nothing else", async () => {
    const { v, handler } = await setup();
    const town = v.files.get("Maps/town.map")!;
    const region = v.files.get("Maps/region.map")!;

    v.move("Maps/westmarch.webp", "Assets/westmarch.webp");
    await handler({ path: "Assets/westmarch.webp" }, "Maps/westmarch.webp");

    const moved = (m: MapDocument): MapDocument => ({ ...m, image: { ...m.image, path: "Assets/westmarch.webp" } });
    expect(v.files.get("Maps/town.map")).toBe(expected(town, moved));
    expect(v.files.get("Maps/region.map")).toBe(expected(region, moved));
    expect(v.processed).not.toContain("Maps/elsewhere.map");
  });

  it("does not process a map that does not reference the renamed file", async () => {
    const { v, handler } = await setup();
    v.move("Places/The Keep.md", "Places/The Old Keep.md");
    await handler({ path: "Places/The Old Keep.md" }, "Places/The Keep.md");
    expect(v.processed).toEqual(["Maps/region.map"]);
  });

  it("does nothing for a file no map references", async () => {
    const { v, handler } = await setup();
    const before = new Map(v.files);
    v.files.set("Notes/Unrelated.md", "");
    v.move("Notes/Unrelated.md", "Notes/Still Unrelated.md");
    before.delete("Notes/Unrelated.md");
    await handler({ path: "Notes/Still Unrelated.md" }, "Notes/Unrelated.md");
    expect(v.processed).toEqual([]);
    for (const [path, text] of before) if (path.endsWith(".map")) expect(v.files.get(path)).toBe(text);
  });

  it("never writes a map that no longer parses", async () => {
    const { v, handler } = await setup();
    // Indexed while valid, then broken on disk before the index caught up.
    const broken = '{"type":"mythical-map","version":1,"image":';
    v.files.set("Maps/town.map", broken);
    v.move("Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    await handler({ path: "Places/The Rusty Flagon.md" }, "Places/Rusty Flagon.md");
    expect(v.processed).toContain("Maps/town.map");
    expect(v.files.get("Maps/town.map")).toBe(broken);
    expect(v.files.get("Maps/invalid.map")).toBe("{ not json");
  });

  it("keeps byte-identical text when a referencing map needs no change", async () => {
    const { v, handler } = await setup();
    const town = v.files.get("Maps/town.map")!;
    // Moving into another folder: basename links still resolve to the new path.
    v.move("Places/Rusty Flagon.md", "Lore/Rusty Flagon.md");
    await handler({ path: "Lore/Rusty Flagon.md" }, "Places/Rusty Flagon.md");
    expect(v.processed).toContain("Maps/town.map");
    expect(v.files.get("Maps/town.map")).toBe(town);
  });

  it("logs and continues when one map fails", async () => {
    const { v, handler } = await setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const town = v.files.get("Maps/town.map")!;
    v.failOn.add("Maps/region.map");
    v.move("Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    await expect(handler({ path: "Places/The Rusty Flagon.md" }, "Places/Rusty Flagon.md")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    expect(v.files.get("Maps/town.map")).toBe(
      expected(town, (m) => withLinks(m, { pflag001: "The Rusty Flagon", pflag002: "The Rusty Flagon#Cellar" })),
    );
  });
});

describe("rename listener through VaultMapIndex.register", () => {
  type Handler = (file: TAbstractFile, oldPath?: string) => void;

  function fakeApp() {
    const handlers = new Map<string, Handler>();
    let layoutReady: (() => void) | undefined;
    const app = {
      workspace: { onLayoutReady: (cb: () => void) => (layoutReady = cb) },
      vault: { on: (name: string, cb: Handler) => (handlers.set(name, cb), { name }) },
    } as unknown as App;
    const plugin = { registerEvent: () => {} } as unknown as Plugin;
    const file = (path: string): TAbstractFile => {
      const ext = basename(path).includes(".") ? path.slice(path.lastIndexOf(".") + 1) : undefined;
      return (ext ? { path, extension: ext } : { path, children: [] }) as unknown as TAbstractFile;
    };
    const fire = (name: string, path: string, oldPath?: string) => handlers.get(name)!(file(path), oldPath);
    return { app, plugin, fire, ready: () => layoutReady!() };
  }

  it("folder rename: one event per child, only links that stop resolving are rewritten", async () => {
    const v = fixtureVault();
    const index = new VaultMapIndex(v);
    const handler = createRenameHandler(v.renameDeps(index));
    const pending: Promise<void>[] = [];
    const f = fakeApp();
    index.register(f.plugin, f.app, {
      onRename: (file, oldPath) => {
        const p = handler(file, oldPath);
        pending.push(p);
        return p;
      },
    });
    f.ready();
    await index.whenIdle();

    const town = v.files.get("Maps/town.map")!;
    const region = v.files.get("Maps/region.map")!;
    const elsewhere = v.files.get("Maps/elsewhere.map")!;

    // Obsidian moves the whole folder, then fires the folder's and each child's rename back to back.
    const children = ["Westmarch.md", "Rusty Flagon.md", "The Keep.md"];
    for (const c of children) v.move(`Places/${c}`, `Lore/Places/${c}`);
    f.fire("rename", "Lore/Places", "Places");
    for (const c of children) f.fire("rename", `Lore/Places/${c}`, `Places/${c}`);
    await Promise.all(pending);
    await index.whenIdle();

    // Basename links still resolve, so town.map and elsewhere.map are untouched.
    expect(v.files.get("Maps/town.map")).toBe(town);
    expect(v.files.get("Maps/elsewhere.map")).toBe(elsewhere);
    // Path-qualified links broke and were rewritten, keeping the subpath.
    expect(v.files.get("Maps/region.map")).toBe(
      expected(region, (m) => withLinks(m, { pflag003: "Rusty Flagon", pkeep001: "The Keep#Gate" })),
    );
    expect(v.resolve("Rusty Flagon")).toBe("Lore/Places/Rusty Flagon.md");
    expect(v.resolve("The Keep")).toBe("Lore/Places/The Keep.md");
    // The write fires `modify` in Obsidian; the fake app does not, so re-index by hand.
    f.fire("modify", "Maps/region.map");
    await index.whenIdle();
    expect(index.brokenPins()).toEqual([]);
  });
});
