import { describe, expect, it } from "vitest";
import { collectLinks, findBroken, rewriteForRename, splitLinktext, type LinkResolver, type RenameContext } from "./links";
import type { MapDocument } from "./schema";

// --- Fake vault -------------------------------------------------------------

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const stripMd = (p: string) => (p.endsWith(".md") ? p.slice(0, -3) : p);
const hasExtension = (p: string) => /\.[^/]+$/.test(basename(p));

/**
 * Resolver over a file list, like `getFirstLinkpathDest`: a linktext with a
 * folder matches the exact path; a bare name matches by basename, preferring
 * the source's folder, then the first path in sort order.
 */
function fakeResolver(files: string[]): LinkResolver {
  const sorted = [...files].sort();
  return {
    resolve(linktext, sourcePath) {
      const target = hasExtension(linktext) ? linktext : `${linktext}.md`;
      if (target.includes("/")) return sorted.includes(target) ? target : null;
      const matches = sorted.filter((f) => basename(f) === target);
      if (matches.length === 0) return null;
      return matches.find((f) => dirname(f) === dirname(sourcePath)) ?? matches[0] ?? null;
    },
  };
}

/** Like `fileToLinktext`: the bare name when unique, else the full path (`.md` dropped). */
function fakeLinktextFor(files: string[]) {
  return (path: string): string => {
    const name = basename(path);
    const unique = files.filter((f) => basename(f) === name).length === 1;
    return stripMd(unique ? name : path);
  };
}

/** Apply a set of moves to a file list. */
const move = (files: string[], moves: Record<string, string>) => files.map((f) => moves[f] ?? f);

// --- Fixtures ---------------------------------------------------------------

const MAP_PATH = "Maps/Westmarch.map";

function makeMap(): MapDocument {
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/westmarch.webp", width: 4096, height: 3072 },
    viewport: { center: [-96, 128], zoom: 2 },
    features: [
      { id: "fold0001", type: "folder", name: "Places", rank: "a0" },
      { id: "pin00001", type: "pin", name: "Inn", rank: "a1", parentId: "fold0001", pos: [-10, 20], link: "Rusty Flagon" },
      { id: "pin00002", type: "pin", name: "Keep", rank: "a2", pos: [-30, 40], link: "Castle#History", style: { iconColor: "#ff0000" } },
      { id: "pin00003", type: "pin", name: "Ghost", rank: "a3", pos: [-50, 60], link: "Missing Note" },
      { id: "pin00004", type: "pin", name: "Unlinked", rank: "a4", pos: [-70, 80] },
      { id: "labl0001", type: "label", name: "Westmarch", rank: "a5", pos: [-5, 5] },
      { id: "regn0001", type: "region", rank: "a6", polygon: [[0, 0], [-1, 0], [-1, 1]] },
    ],
  };
}

const FILES = [
  "Maps/Westmarch.map",
  "Maps/westmarch.webp",
  "Places/Rusty Flagon.md",
  "Places/Castle.md",
  "Notes/Readme.md",
];

/** Build a rename context from a before/after file list. */
function renameCtx(map: MapDocument, before: string[], oldPath: string, newPath: string): RenameContext {
  const after = move(before, { [oldPath]: newPath });
  const previouslyResolved = Object.fromEntries(
    collectLinks(map, MAP_PATH, fakeResolver(before)).map((l) => [l.featureId, l.resolvedPath]),
  );
  return {
    mapPath: MAP_PATH,
    oldPath,
    newPath,
    previouslyResolved,
    linktextFor: fakeLinktextFor(after),
    resolveNow: fakeResolver(after),
  };
}

/** Everything except pin links and image.path, for "nothing else changed" checks. */
function withoutLinkFields(map: MapDocument): unknown {
  return {
    ...map,
    image: { ...map.image, path: undefined },
    features: map.features.map((f) => (f.type === "pin" ? { ...f, link: undefined } : f)),
  };
}

const linkOf = (map: MapDocument, id: string) => {
  const f = map.features.find((x) => x.id === id);
  return f?.type === "pin" ? f.link : undefined;
};

// --- Tests ------------------------------------------------------------------

describe("splitLinktext", () => {
  it("returns the whole link as the path when there is no subpath", () => {
    expect(splitLinktext("Rusty Flagon")).toEqual({ path: "Rusty Flagon", subpath: "" });
  });

  it("splits a heading subpath, keeping the #", () => {
    expect(splitLinktext("Castle#History")).toEqual({ path: "Castle", subpath: "#History" });
  });

  it("splits a block subpath at the first #", () => {
    expect(splitLinktext("Places/Castle#^abc123")).toEqual({ path: "Places/Castle", subpath: "#^abc123" });
    expect(splitLinktext("Castle#A#B")).toEqual({ path: "Castle", subpath: "#A#B" });
  });
});

describe("collectLinks", () => {
  it("lists every linked pin with its resolved path, resolving without the subpath", () => {
    expect(collectLinks(makeMap(), MAP_PATH, fakeResolver(FILES))).toEqual([
      { featureId: "pin00001", link: "Rusty Flagon", resolvedPath: "Places/Rusty Flagon.md" },
      { featureId: "pin00002", link: "Castle#History", resolvedPath: "Places/Castle.md" },
      { featureId: "pin00003", link: "Missing Note", resolvedPath: null },
    ]);
  });

  it("passes only the path part and the map path to the resolver", () => {
    const calls: [string, string][] = [];
    const resolver: LinkResolver = {
      resolve(linktext, sourcePath) {
        calls.push([linktext, sourcePath]);
        return null;
      },
    };
    collectLinks(makeMap(), MAP_PATH, resolver);
    expect(calls).toEqual([
      ["Rusty Flagon", MAP_PATH],
      ["Castle", MAP_PATH],
      ["Missing Note", MAP_PATH],
    ]);
  });

  it("returns nothing for a map without links", () => {
    const map = { ...makeMap(), features: [] };
    expect(collectLinks(map, MAP_PATH, fakeResolver(FILES))).toEqual([]);
  });
});

describe("findBroken", () => {
  it("returns only the pins whose link does not resolve", () => {
    expect(findBroken(makeMap(), MAP_PATH, fakeResolver(FILES))).toEqual([
      { featureId: "pin00003", link: "Missing Note", resolvedPath: null },
    ]);
  });

  it("does not modify the map", () => {
    const map = makeMap();
    findBroken(map, MAP_PATH, fakeResolver(FILES));
    expect(map).toEqual(makeMap());
  });
});

describe("rewriteForRename", () => {
  it("rewrites a link when its note is renamed", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(true);
    expect(linkOf(result.map, "pin00001")).toBe("The Rusty Flagon");
    expect(collectLinks(result.map, MAP_PATH, ctx.resolveNow)[0]?.resolvedPath).toBe("Places/The Rusty Flagon.md");
    expect(withoutLinkFields(result.map)).toEqual(withoutLinkFields(makeMap()));
    expect(result.map.image.path).toBe("Maps/westmarch.webp");
    expect(map).toEqual(makeMap()); // input not mutated
  });

  it("leaves the link as-is when a uniquely named note moves to another folder", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Places/Rusty Flagon.md", "Archive/Rusty Flagon.md");
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it("preserves a heading subpath when rewriting", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Places/Castle.md", "Places/Old Castle.md");
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(true);
    expect(linkOf(result.map, "pin00002")).toBe("Old Castle#History");
    expect(withoutLinkFields(result.map)).toEqual(withoutLinkFields(makeMap()));
  });

  it("uses a path linktext when the new name is ambiguous", () => {
    const files = [...FILES, "Other/The Rusty Flagon.md"];
    const map = makeMap();
    const ctx = renameCtx(map, files, "Places/Rusty Flagon.md", "Places/The Rusty Flagon.md");
    const result = rewriteForRename(map, ctx);

    expect(linkOf(result.map, "pin00001")).toBe("Places/The Rusty Flagon");
    expect(ctx.resolveNow.resolve("Places/The Rusty Flagon", MAP_PATH)).toBe("Places/The Rusty Flagon.md");
  });

  it("on a folder rename, rewrites only links that no longer resolve", () => {
    // Places/ → Locations/. "Rusty Flagon" is a unique bare name and still
    // resolves; "Places/Castle" is a path link (Castle has a namesake in Lore/)
    // and breaks, so it is rewritten.
    const before = [...FILES, "Lore/Castle.md"];
    const moves = {
      "Places/Rusty Flagon.md": "Locations/Rusty Flagon.md",
      "Places/Castle.md": "Locations/Castle.md",
    };
    const resolveBefore = fakeResolver(before);
    let map: MapDocument = {
      ...makeMap(),
      features: makeMap().features.map((f) => (f.id === "pin00002" ? { ...f, link: "Places/Castle#History" } : f)),
    };
    const original = map;
    const previouslyResolved = Object.fromEntries(
      collectLinks(map, MAP_PATH, resolveBefore).map((l) => [l.featureId, l.resolvedPath]),
    );
    expect(previouslyResolved.pin00002).toBe("Places/Castle.md");

    // Obsidian fires one rename event per child file, against the progressively moved vault.
    let files = before;
    let anyChanged = false;
    for (const [oldPath, newPath] of Object.entries(moves)) {
      files = move(files, { [oldPath]: newPath });
      const result = rewriteForRename(map, {
        mapPath: MAP_PATH,
        oldPath,
        newPath,
        previouslyResolved,
        linktextFor: fakeLinktextFor(files),
        resolveNow: fakeResolver(files),
      });
      anyChanged ||= result.changed;
      map = result.map;
    }

    expect(anyChanged).toBe(true);
    expect(linkOf(map, "pin00001")).toBe("Rusty Flagon"); // still resolves, untouched
    expect(linkOf(map, "pin00002")).toBe("Locations/Castle#History"); // rewritten, subpath kept
    expect(linkOf(map, "pin00003")).toBe("Missing Note"); // broken, untouched
    expect(collectLinks(map, MAP_PATH, fakeResolver(files)).map((l) => l.resolvedPath)).toEqual([
      "Locations/Rusty Flagon.md",
      "Locations/Castle.md",
      null,
    ]);
    expect(withoutLinkFields(map)).toEqual(withoutLinkFields(original));
  });

  it("updates image.path when the image is moved", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Maps/westmarch.webp", "Assets/westmarch.webp");
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(true);
    expect(result.map.image).toEqual({ path: "Assets/westmarch.webp", width: 4096, height: 3072 });
    expect(result.map.features).toBe(map.features);
    expect(withoutLinkFields(result.map)).toEqual(withoutLinkFields(makeMap()));
    expect(map.image.path).toBe("Maps/westmarch.webp");
  });

  it("leaves broken links untouched, even when a matching file is renamed", () => {
    // "Missing Note" was broken before; a file later renamed from elsewhere must not adopt it.
    const files = [...FILES, "Notes/Something.md"];
    const map = makeMap();
    const ctx = renameCtx(map, files, "Notes/Something.md", "Notes/Missing Note.md");
    expect(ctx.previouslyResolved.pin00003).toBeNull();
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
    expect(linkOf(result.map, "pin00003")).toBe("Missing Note");
  });

  it("leaves pins that resolved to a different file untouched", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Notes/Readme.md", "Notes/Guide.md");
    const result = rewriteForRename(map, ctx);

    expect(result.changed).toBe(false);
    expect(result.map).toBe(map);
  });

  it("is a no-op when the map file itself is renamed", () => {
    const map = makeMap();
    const result = rewriteForRename(map, {
      mapPath: MAP_PATH,
      oldPath: MAP_PATH,
      newPath: "Atlas/Westmarch.map",
      previouslyResolved: { pin00001: "Places/Rusty Flagon.md" },
      linktextFor: () => "should not be used",
      resolveNow: fakeResolver(move(FILES, { [MAP_PATH]: "Atlas/Westmarch.map" })),
    });

    expect(result).toEqual({ map, changed: false });
    expect(result.map).toBe(map);
  });

  it("returns the same reference when nothing changed", () => {
    const map = makeMap();
    const ctx = renameCtx(map, FILES, "Notes/Unrelated.md", "Notes/Other.md");
    expect(rewriteForRename(map, ctx).map).toBe(map);
  });
});
