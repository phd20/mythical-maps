import { describe, expect, it } from "vitest";
import type { LinkResolver } from "../src/core/links";
import { noteMapsForLink, parseMapEntry, readMapEntries, type NoteFrontmatterReader } from "../src/core/noteMaps";

const FILES = ["Places/Westmarch.md", "Maps/Westmarch.map", "Maps/Westmarch Sewers.map", "Maps/readme.md"];
const baseName = (f: string): string => f.slice(f.lastIndexOf("/") + 1);
const resolver: LinkResolver = {
  resolve: (linktext) =>
    FILES.find((f) => f === linktext || baseName(f) === linktext || baseName(f) === `${linktext}.md`) ?? null,
};
const readerOf = (fm: Record<string, unknown> | undefined): NoteFrontmatterReader => ({ read: () => fm });

describe("parseMapEntry", () => {
  it("handles wikilinks, aliases, subpaths and plain text", () => {
    expect(parseMapEntry("[[Westmarch.map]]")).toEqual({ linkpath: "Westmarch.map" });
    expect(parseMapEntry("[[A.map|Old Town]]")).toEqual({ linkpath: "A.map", alias: "Old Town" });
    expect(parseMapEntry("A.map#x")).toEqual({ linkpath: "A.map" });
    expect(parseMapEntry("  ")).toBeNull();
    expect(parseMapEntry("[[]]")).toBeNull();
  });
});

describe("readMapEntries", () => {
  it("reads a list, a single string, and unquoted nested wikilinks", () => {
    expect(readMapEntries({ maps: ["[[A.map]]", "B.map"] }, "maps").map((e) => e.linkpath)).toEqual(["A.map", "B.map"]);
    expect(readMapEntries({ maps: "[[A.map]]" }, "maps")).toEqual([{ linkpath: "A.map" }]);
    expect(readMapEntries({ maps: [["A.map"]] }, "maps")).toEqual([{ linkpath: "A.map" }]);
  });
  it("only reads the configured property and skips non-strings", () => {
    expect(readMapEntries({ maps: ["A.map"] }, "region-maps")).toEqual([]);
    expect(readMapEntries({ "region-maps": ["A.map", 3, null] }, "region-maps")).toEqual([{ linkpath: "A.map" }]);
    expect(readMapEntries(undefined, "maps")).toEqual([]);
    expect(readMapEntries({ maps: ["A.map"] }, "")).toEqual([]);
  });
});

describe("noteMapsForLink", () => {
  const fm = { maps: ["[[Westmarch.map]]", "[[Westmarch Sewers.map]]"] };
  it("lists each resolving map with its name and path", () => {
    expect(noteMapsForLink("Westmarch", "Maps/world.map", "maps", readerOf(fm), resolver)).toEqual([
      { name: "Westmarch", path: "Maps/Westmarch.map" },
      { name: "Westmarch Sewers", path: "Maps/Westmarch Sewers.map" },
    ]);
  });
  it("ignores unresolved entries, non-.map files and duplicates without error", () => {
    const f = { maps: ["[[Nope.map]]", "[[readme]]", "[[Westmarch.map]]", "[[Westmarch.map]]"] };
    expect(noteMapsForLink("Westmarch", "Maps/world.map", "maps", readerOf(f), resolver)).toEqual([
      { name: "Westmarch", path: "Maps/Westmarch.map" },
    ]);
  });
  it("uses an alias as the name", () => {
    const f = { maps: ["[[Westmarch.map|City]]"] };
    expect(noteMapsForLink("Westmarch", "m.map", "maps", readerOf(f), resolver)[0]?.name).toBe("City");
  });
  it("is empty for a broken pin link, a same-file link or a note without the property", () => {
    expect(noteMapsForLink("Missing", "m.map", "maps", readerOf(fm), resolver)).toEqual([]);
    expect(noteMapsForLink("#H", "m.map", "maps", readerOf(fm), resolver)).toEqual([]);
    expect(noteMapsForLink("Westmarch", "m.map", "maps", readerOf({}), resolver)).toEqual([]);
    expect(noteMapsForLink("Westmarch", "m.map", "maps", readerOf(undefined), resolver)).toEqual([]);
  });
  it("reads the renamed property, not maps", () => {
    expect(noteMapsForLink("Westmarch", "m.map", "region-maps", readerOf(fm), resolver)).toEqual([]);
    const renamed = { "region-maps": ["Westmarch.map"] };
    expect(noteMapsForLink("Westmarch", "m.map", "region-maps", readerOf(renamed), resolver)).toHaveLength(1);
  });
});
