import { describe, expect, it } from "vitest";
import { relinkInText, scanBrokenPins, type BrokenPinSource, type LinkedPinRef } from "./brokenPins";
import type { LinkResolver } from "./links";
import { parseMap } from "./parse";

const existing = new Set(["Waterdeep", "Baldur's Gate"]);
const resolver: LinkResolver = { resolve: (linktext) => (existing.has(linktext) ? `${linktext}.md` : null) };

function source(maps: Record<string, LinkedPinRef[]>): BrokenPinSource {
  return { mapPaths: () => Object.keys(maps), linkedPins: (p) => maps[p] ?? [] };
}

describe("scanBrokenPins", () => {
  it("groups broken pins by map, sorted by map path, skipping maps with none", () => {
    const groups = scanBrokenPins(
      source({
        "b.map": [{ featureId: "p1", link: "Missing" }, { featureId: "p2", link: "Waterdeep" }, { featureId: "p3", link: "Gone#Heading" }],
        "a.map": [{ featureId: "q1", link: "Nowhere" }],
        "ok.map": [{ featureId: "r1", link: "Waterdeep#Docks" }],
        "empty.map": [],
      }),
      resolver,
    );
    expect(groups).toEqual([
      { mapPath: "a.map", pins: [{ featureId: "q1", link: "Nowhere" }] },
      {
        mapPath: "b.map",
        pins: [
          { featureId: "p1", link: "Missing" },
          { featureId: "p3", link: "Gone#Heading" },
        ],
      },
    ]);
  });

  it("returns an empty list when nothing is broken", () => {
    expect(scanBrokenPins(source({ "a.map": [{ featureId: "p", link: "Waterdeep" }] }), resolver)).toEqual([]);
    expect(scanBrokenPins(source({}), resolver)).toEqual([]);
  });

  it("re-resolves with the given resolver, ignoring any cached resolution", () => {
    const src = source({ "a.map": [{ featureId: "p", link: "Late" }] });
    expect(scanBrokenPins(src, resolver)).toHaveLength(1);
    expect(scanBrokenPins(src, { resolve: () => "Late.md" })).toEqual([]);
  });

  it("treats a same-file subpath link as broken", () => {
    expect(scanBrokenPins(source({ "a.map": [{ featureId: "p", link: "#Heading" }] }), resolver)).toHaveLength(1);
  });
});

const MAP = JSON.stringify({
  type: "mythical-map",
  version: 1,
  image: { path: "i.png", width: 100, height: 100 },
  features: [
    { id: "pinaaaa1", type: "pin", rank: "a", pos: [1, 2], link: "Missing" },
    { id: "labbbbb1", type: "label", rank: "b", pos: [3, 4], name: "L" },
  ],
});

describe("relinkInText", () => {
  it("sets the pin's link and writes canonical text", () => {
    const out = relinkInText(MAP, "pinaaaa1", "Waterdeep");
    const parsed = parseMap(out);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    expect(parsed.map.features.find((f) => f.id === "pinaaaa1")).toMatchObject({ link: "Waterdeep" });
    expect(parsed.map.features.find((f) => f.id === "labbbbb1")).not.toHaveProperty("link");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("returns the text unchanged for a file that does not parse", () => {
    expect(relinkInText("{ not json", "pinaaaa1", "Waterdeep")).toBe("{ not json");
  });

  it("returns the text unchanged for an unknown id, a non-pin id or an empty link", () => {
    expect(relinkInText(MAP, "nope", "Waterdeep")).toBe(MAP);
    expect(relinkInText(MAP, "labbbbb1", "Waterdeep")).toBe(MAP);
    expect(relinkInText(MAP, "pinaaaa1", "")).toBe(MAP);
  });
});
