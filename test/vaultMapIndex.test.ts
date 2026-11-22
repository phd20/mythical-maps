import { describe, expect, it } from "vitest";
import type { App, Plugin, TAbstractFile } from "obsidian";
import { VaultMapIndex, type VaultMapIndexDeps } from "../src/obsidian/vaultMapIndex";

/** In-memory vault: every file path with its text. Notes resolve by basename, like wikilinks. */
class FakeVault implements VaultMapIndexDeps {
  files = new Map<string, string>();
  reads = 0;

  listMapFiles(): string[] {
    return [...this.files.keys()].filter((p) => p.endsWith(".map"));
  }

  async read(path: string): Promise<string> {
    this.reads++;
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`missing ${path}`);
    return text;
  }

  resolver = {
    resolve: (linktext: string, _sourcePath: string): string | null => {
      for (const path of this.files.keys()) {
        const base = path.slice(path.lastIndexOf("/") + 1);
        if (path === linktext || path === `${linktext}.md` || base === `${linktext}.md` || base === linktext) return path;
      }
      return null;
    },
  };

  move(from: string, to: string): void {
    const text = this.files.get(from);
    if (text === undefined) throw new Error(`missing ${from}`);
    this.files.delete(from);
    this.files.set(to, text);
  }
}

type Pin = { id: string; link?: string };

function mapText(image: string, pins: Pin[]): string {
  return JSON.stringify({
    type: "mythical-map",
    version: 1,
    image: { path: image, width: 4096, height: 3072 },
    features: pins.map((p, i) => ({ id: p.id, type: "pin", rank: `a${i}`, pos: [-96, 128], ...(p.link ? { link: p.link } : {}) })),
  });
}

function fixtureVault(): FakeVault {
  const v = new FakeVault();
  v.files.set("Places/Westmarch.md", "# Westmarch");
  v.files.set("Places/Rusty Flagon.md", "# Rusty Flagon");
  v.files.set("Places/The Keep.md", "# The Keep");
  v.files.set("Maps/fixture-4k.png", "");
  v.files.set("Maps/fixture-8k.png", "");
  v.files.set(
    "Maps/all-types.map",
    mapText("Maps/fixture-4k.png", [{ id: "pwestm01", link: "Westmarch" }, { id: "pnolnk01" }]),
  );
  v.files.set(
    "Maps/big-8k.map",
    mapText("Maps/fixture-8k.png", [
      { id: "pcentr01", link: "Westmarch" },
      { id: "pseast01", link: "Rusty Flagon" },
    ]),
  );
  v.files.set(
    "Maps/broken-links.map",
    mapText("Maps/fixture-4k.png", [
      { id: "pnowhe01", link: "Nowhere Inn" },
      { id: "plostc01", link: "Lost City#Gates" },
      { id: "pkeepo01", link: "The Keep" },
    ]),
  );
  v.files.set("Maps/invalid-json.map", "{ not json");
  return v;
}

async function built(v = fixtureVault()): Promise<{ v: FakeVault; index: VaultMapIndex }> {
  const index = new VaultMapIndex(v);
  await index.build();
  return { v, index };
}

describe("VaultMapIndex", () => {
  it("builds from every .map file, keeping invalid maps as ok:false", async () => {
    const { index } = await built();
    expect(index.allMaps()).toEqual(["Maps/all-types.map", "Maps/big-8k.map", "Maps/broken-links.map", "Maps/invalid-json.map"]);
    expect(index.get("Maps/invalid-json.map")).toEqual({ ok: false, links: [] });
    expect(index.get("Maps/big-8k.map")).toEqual({
      ok: true,
      imagePath: "Maps/fixture-8k.png",
      links: [
        { featureId: "pcentr01", link: "Westmarch", resolvedPath: "Places/Westmarch.md" },
        { featureId: "pseast01", link: "Rusty Flagon", resolvedPath: "Places/Rusty Flagon.md" },
      ],
    });
  });

  it("lists the maps referencing a note and an image", async () => {
    const { index } = await built();
    expect(index.mapsReferencing("Places/Westmarch.md")).toEqual(["Maps/all-types.map", "Maps/big-8k.map"]);
    expect(index.mapsReferencing("Places/The Keep.md")).toEqual(["Maps/broken-links.map"]);
    expect(index.mapsReferencing("Maps/fixture-4k.png")).toEqual(["Maps/all-types.map", "Maps/broken-links.map"]);
    expect(index.mapsReferencing("Places/Nowhere.md")).toEqual([]);
  });

  it("reports broken pins by map, keeping the subpath in the link", async () => {
    const { index } = await built();
    expect(index.brokenPins()).toEqual([
      { mapPath: "Maps/broken-links.map", featureId: "pnowhe01", link: "Nowhere Inn" },
      { mapPath: "Maps/broken-links.map", featureId: "plostc01", link: "Lost City#Gates" },
    ]);
  });

  it("exposes what each pin previously resolved to", async () => {
    const { index } = await built();
    expect(index.previouslyResolved("Maps/broken-links.map")).toEqual({
      pnowhe01: null,
      plostc01: null,
      pkeepo01: "Places/The Keep.md",
    });
    expect(index.previouslyResolved("Maps/unknown.map")).toEqual({});
  });

  it("update after a modify picks up a new link", async () => {
    const { v, index } = await built();
    v.files.set(
      "Maps/all-types.map",
      mapText("Maps/fixture-4k.png", [{ id: "pwestm01", link: "Westmarch" }, { id: "pnolnk01", link: "Rusty Flagon" }]),
    );
    await index.update("Maps/all-types.map");
    expect(index.mapsReferencing("Places/Rusty Flagon.md")).toEqual(["Maps/all-types.map", "Maps/big-8k.map"]);
  });

  it("update indexes a newly created map and drops one that can no longer be read", async () => {
    const { v, index } = await built();
    v.files.set("Maps/new.map", mapText("Maps/fixture-8k.png", [{ id: "pnew0001", link: "The Keep" }]));
    await index.update("Maps/new.map");
    expect(index.mapsReferencing("Places/The Keep.md")).toEqual(["Maps/broken-links.map", "Maps/new.map"]);
    v.files.delete("Maps/new.map");
    await index.update("Maps/new.map");
    expect(index.allMaps()).not.toContain("Maps/new.map");
  });

  it("a map that becomes invalid is kept as ok:false with no links", async () => {
    const { v, index } = await built();
    v.files.set("Maps/big-8k.map", '{"type":"mythical-map","version":99}');
    await index.update("Maps/big-8k.map");
    expect(index.get("Maps/big-8k.map")).toEqual({ ok: false, links: [] });
    expect(index.mapsReferencing("Places/Rusty Flagon.md")).toEqual([]);
  });

  it("concurrent updates for the same path apply in call order", async () => {
    const v = fixtureVault();
    const index = new VaultMapIndex(v);
    await index.build();
    // Make the first read slow and the second fast; order must still be preserved.
    const texts = [
      mapText("Maps/fixture-8k.png", [{ id: "pfirst01", link: "Westmarch" }]),
      mapText("Maps/fixture-8k.png", [{ id: "psecnd01", link: "The Keep" }]),
    ];
    const delays = [20, 0];
    let call = 0;
    v.read = async () => {
      const i = call++;
      await new Promise((r) => setTimeout(r, delays[i]));
      return texts[i]!;
    };
    const a = index.update("Maps/big-8k.map");
    const b = index.update("Maps/big-8k.map");
    await Promise.all([a, b]);
    expect(index.get("Maps/big-8k.map")?.links.map((l) => l.featureId)).toEqual(["psecnd01"]);
  });

  it("remove forgets a deleted map", async () => {
    const { index } = await built();
    await index.remove("Maps/big-8k.map");
    expect(index.allMaps()).not.toContain("Maps/big-8k.map");
    expect(index.mapsReferencing("Places/Rusty Flagon.md")).toEqual([]);
  });

  it("rename moves a map's entry without re-reading it", async () => {
    const { v, index } = await built();
    v.move("Maps/big-8k.map", "Atlas/big.map");
    const reads = v.reads;
    await index.rename("Maps/big-8k.map", "Atlas/big.map");
    expect(v.reads).toBe(reads);
    expect(index.allMaps()).toContain("Atlas/big.map");
    expect(index.allMaps()).not.toContain("Maps/big-8k.map");
    expect(index.mapsReferencing("Places/Rusty Flagon.md")).toEqual(["Atlas/big.map"]);
    expect(index.previouslyResolved("Atlas/big.map")).toEqual({
      pcentr01: "Places/Westmarch.md",
      pseast01: "Places/Rusty Flagon.md",
    });
  });

  it("refreshResolution after a note rename turns a resolved link into a broken one", async () => {
    const { v, index } = await built();
    v.move("Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    // Before refreshing, the index still remembers the old resolution (what 6.5 needs).
    expect(index.previouslyResolved("Maps/big-8k.map").pseast01).toBe("Places/Rusty Flagon.md");
    const reads = v.reads;
    index.refreshResolution();
    expect(v.reads).toBe(reads);
    expect(index.mapsReferencing("Places/Rusty Flagon.md")).toEqual([]);
    expect(index.brokenPins()).toContainEqual({ mapPath: "Maps/big-8k.map", featureId: "pseast01", link: "Rusty Flagon" });
  });

  it("refreshResolution after a note is created fixes a broken link", async () => {
    const { v, index } = await built();
    v.files.set("Places/Lost City.md", "# Lost City");
    index.refreshResolution();
    expect(index.mapsReferencing("Places/Lost City.md")).toEqual(["Maps/broken-links.map"]);
    expect(index.brokenPins().map((b) => b.featureId)).toEqual(["pnowhe01"]);
  });
});

describe("VaultMapIndex.register", () => {
  type Handler = (file: TAbstractFile, oldPath?: string) => void;

  function fakeApp() {
    const handlers = new Map<string, Handler>();
    let layoutReady: (() => void) | undefined;
    const app = {
      workspace: { onLayoutReady: (cb: () => void) => (layoutReady = cb) },
      vault: { on: (name: string, cb: Handler) => (handlers.set(name, cb), { name }) },
    } as unknown as App;
    const registered: unknown[] = [];
    const plugin = { registerEvent: (ref: unknown) => registered.push(ref) } as unknown as Plugin;
    const file = (path: string): TAbstractFile => {
      const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1) : undefined;
      return (ext ? { path, extension: ext } : { path, children: [] }) as unknown as TAbstractFile;
    };
    const fire = (name: string, path: string, oldPath?: string) => handlers.get(name)!(file(path), oldPath);
    return { app, plugin, registered, fire, ready: () => layoutReady!() };
  }

  it("builds on layout ready and follows vault events", async () => {
    const v = fixtureVault();
    const index = new VaultMapIndex(v);
    const f = fakeApp();
    index.register(f.plugin, f.app);
    expect(f.registered).toHaveLength(0);
    f.ready();
    expect(f.registered).toHaveLength(4);
    await index.whenIdle();
    expect(index.allMaps()).toHaveLength(4);

    v.files.set("Maps/new.map", mapText("Maps/fixture-8k.png", [{ id: "pnew0001", link: "The Keep" }]));
    f.fire("create", "Maps/new.map");
    v.files.set("Maps/new.map", mapText("Maps/fixture-8k.png", [{ id: "pnew0001", link: "Westmarch" }]));
    f.fire("modify", "Maps/new.map");
    await index.whenIdle();
    expect(index.mapsReferencing("Places/Westmarch.md")).toContain("Maps/new.map");
    expect(index.mapsReferencing("Places/The Keep.md")).not.toContain("Maps/new.map");

    v.move("Maps/new.map", "Maps/renamed.map");
    f.fire("rename", "Maps/renamed.map", "Maps/new.map");
    await index.whenIdle();
    expect(index.allMaps()).toContain("Maps/renamed.map");
    expect(index.allMaps()).not.toContain("Maps/new.map");

    v.files.delete("Maps/renamed.map");
    f.fire("delete", "Maps/renamed.map");
    await index.whenIdle();
    expect(index.allMaps()).not.toContain("Maps/renamed.map");
  });

  it("re-resolves links on a note rename, after the onRename hook sees the old state", async () => {
    const v = fixtureVault();
    const index = new VaultMapIndex(v);
    const f = fakeApp();
    const seen: Array<Record<string, string | null>> = [];
    index.register(f.plugin, f.app, { onRename: () => void seen.push(index.previouslyResolved("Maps/big-8k.map")) });
    f.ready();
    await index.whenIdle();

    v.move("Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    f.fire("rename", "Places/The Rusty Flagon.md", "Places/Rusty Flagon.md");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen[0]?.pseast01).toBe("Places/Rusty Flagon.md");
    expect(index.previouslyResolved("Maps/big-8k.map").pseast01).toBeNull();

    // Modifying a note does not touch the index; creating one re-resolves.
    const reads = v.reads;
    f.fire("modify", "Places/Westmarch.md");
    v.files.set("Places/Nowhere Inn.md", "");
    f.fire("create", "Places/Nowhere Inn.md");
    expect(v.reads).toBe(reads);
    expect(index.brokenPins().map((b) => b.featureId)).not.toContain("pnowhe01");
  });
});
