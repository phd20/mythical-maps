import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as L from "leaflet";
// vitest aliases `leaflet` to this stub (see vitest.config.ts).
import { featureLayers, type MockDivIcon, type MockFeatureLayer } from "./mocks/leaflet";
import {
  createFeatureRenderer,
  dashArrayFor,
  pathPathOptions,
  regionPathOptions,
  type IconProvider,
} from "../src/ui/featureRenderer";
import { validateMap, type Feature, type MapDocument } from "../src/core/schema";
import { DEFAULT_STYLES } from "../src/core/style";

/** Minimal DOM element: enough for what the renderer builds. */
class FakeEl {
  className = "";
  textContent: string | null = null;
  children: FakeEl[] = [];
  styles: Record<string, string> = {};
  style = { setProperty: (k: string, v: string) => (this.styles[k] = v) };
  icon: string | undefined;
  constructor(
    public tag: string,
    public doc: FakeDoc,
  ) {}
  appendChild(c: FakeEl): FakeEl {
    this.children.push(c);
    return c;
  }
  /** Depth-first search by class name. */
  find(cls: string): FakeEl | undefined {
    if (this.className.split(" ").includes(cls)) return this;
    for (const c of this.children) {
      const hit = c.find(cls);
      if (hit) return hit;
    }
    return undefined;
  }
}

class FakeDoc {
  createElement(tag: string): FakeEl {
    return new FakeEl(tag, this);
  }
}

const KNOWN = new Set(["map-pin", "castle", "beer"]);
const icons: IconProvider = {
  has: (n) => KNOWN.has(n),
  set: (el, n) => {
    (el as unknown as FakeEl).icon = n;
  },
};

const doc = new FakeDoc();
const fakeMap = { name: "map" } as unknown as L.Map;

function setup() {
  return createFeatureRenderer(fakeMap, { icons, ownerDocument: doc as unknown as Document });
}

function model(features: Feature[]): MapDocument {
  return { type: "mythical-map", version: 1, image: { path: "x.png", width: 256, height: 256 }, features };
}

const asMock = (l: L.Layer | undefined) => l as unknown as MockFeatureLayer;
const iconOf = (l: MockFeatureLayer) => l.options.icon as MockDivIcon;
const htmlOf = (l: MockFeatureLayer) => iconOf(l).options.html as FakeEl;

const pin = (over: Partial<Extract<Feature, { type: "pin" }>> = {}): Feature => ({
  id: "ppin0001",
  type: "pin",
  rank: "a0",
  pos: [-10, 20],
  ...over,
});

beforeEach(() => {
  featureLayers.length = 0;
});

describe("layer reuse by id", () => {
  it("keeps the same layer across renders and updates it in place", () => {
    const r = setup();
    r.render(model([pin({ name: "A" })]));
    const first = asMock(r.layerFor("ppin0001"));
    expect(first.map).toBe(fakeMap);
    r.render(model([pin({ name: "A", pos: [-30, 40] })]));
    const second = asMock(r.layerFor("ppin0001"));
    expect(second).toBe(first);
    expect(featureLayers).toHaveLength(1);
    expect(second.latlngs).toEqual([-30, 40]);
    // Unchanged style → icon not rebuilt; unchanged name → tooltip untouched.
    expect(second.callNames).toEqual(["bindTooltip", "setLatLng"]);
  });

  it("rebuilds the icon only when the style changes", () => {
    const r = setup();
    r.render(model([pin()]));
    r.render(model([pin({ style: { iconColor: "#112233" } })]));
    const l = asMock(r.layerFor("ppin0001"));
    expect(l.callNames.filter((n) => n === "setIcon")).toHaveLength(1);
    expect(htmlOf(l).styles["--mythical-map-pin-color"]).toBe("#112233");
  });

  it("updates regions and paths with setLatLngs and setStyle", () => {
    const r = setup();
    const region: Feature = { id: "rreg0001", type: "region", rank: "a0", polygon: [[0, 0], [0, 1], [1, 1]] };
    const path: Feature = { id: "hpth0001", type: "path", rank: "a1", polyline: [[0, 0], [1, 1]] };
    r.render(model([region, path]));
    const rl = asMock(r.layerFor("rreg0001"));
    const pl = asMock(r.layerFor("hpth0001"));
    r.render(model([
      { ...region, polygon: [[0, 0], [0, 2], [2, 2]], style: { color: "#FF0000" } },
      { ...path, polyline: [[0, 0], [3, 3]] },
    ]));
    expect(r.layerFor("rreg0001")).toBe(rl);
    expect(r.layerFor("hpth0001")).toBe(pl);
    expect(rl.latlngs).toEqual([[[0, 0], [0, 2], [2, 2]]]);
    expect(rl.options.color).toBe("#FF0000");
    expect(pl.latlngs).toEqual([[0, 0], [3, 3]]);
    expect(pl.callNames).toEqual(["setLatLngs", "setStyle"]);
  });

  it("removes layers of deleted features", () => {
    const r = setup();
    r.render(model([pin(), pin({ id: "ppin0002" })]));
    const gone = asMock(r.layerFor("ppin0002"));
    r.render(model([pin()]));
    expect(gone.removed).toBe(true);
    expect(r.layerFor("ppin0002")).toBeUndefined();
    expect(asMock(r.layerFor("ppin0001")).removed).toBe(false);
  });

  it("replaces the layer when a feature's type changes", () => {
    const r = setup();
    r.render(model([pin({ name: "X" })]));
    const old = asMock(r.layerFor("ppin0001"));
    r.render(model([{ id: "ppin0001", type: "label", rank: "a0", name: "X", pos: [-10, 20] }]));
    expect(old.removed).toBe(true);
    expect(asMock(r.layerFor("ppin0001")).map).toBe(fakeMap);
    expect(r.layerFor("ppin0001")).not.toBe(old);
  });

  it("draws nothing for folders", () => {
    const r = setup();
    r.render(model([{ id: "ffold001", type: "folder", rank: "a0", name: "F" }]));
    expect(featureLayers).toHaveLength(0);
    expect(r.layerFor("ffold001")).toBeUndefined();
  });

  it("skips features the view marks invisible, and removes them when they become so", () => {
    const r = setup();
    r.render(model([pin()]));
    const l = asMock(r.layerFor("ppin0001"));
    r.render(model([pin()]), { isVisible: () => false });
    expect(l.removed).toBe(true);
    r.render(model([pin()]));
    expect(asMock(r.layerFor("ppin0001")).map).toBe(fakeMap);
  });

  it("destroy removes everything and later renders do nothing", () => {
    const r = setup();
    r.render(model([pin()]));
    const l = asMock(r.layerFor("ppin0001"));
    r.destroy();
    r.destroy();
    expect(l.removed).toBe(true);
    r.render(model([pin()]));
    expect(featureLayers).toHaveLength(1);
  });

  it("uses an injected style resolver", () => {
    const r = setup();
    r.render(model([pin()]), {
      resolveStyle: () => ({ ...DEFAULT_STYLES.pin, iconColor: "#ABCDEF", iconGlyph: "beer" }),
    });
    const html = htmlOf(asMock(r.layerFor("ppin0001")));
    expect(html.styles["--mythical-map-pin-color"]).toBe("#ABCDEF");
    expect(html.find("mythical-map-pin-glyph")?.icon).toBe("beer");
  });
});

describe("pins", () => {
  it("draws shape, glyph, colour and size", () => {
    const r = setup();
    r.render(model([pin({ style: { iconGlyph: "castle", iconColor: "#3366CC", iconShape: "shield", iconSize: "small" } })]));
    const l = asMock(r.layerFor("ppin0001"));
    expect(l.kind).toBe("marker");
    const icon = iconOf(l).options;
    expect(icon.iconSize).toEqual([24, 24]);
    expect(icon.iconAnchor).toEqual([12, 24]);
    const html = icon.html as FakeEl;
    expect(html.doc).toBe(doc);
    expect(html.className).toBe("mythical-map-pin mythical-map-pin-shield mythical-map-pin-small");
    expect(html.styles["--mythical-map-pin-color"]).toBe("#3366CC");
    expect(html.find("mythical-map-pin-shape")).toBeDefined();
    expect(html.find("mythical-map-pin-glyph")?.icon).toBe("castle");
    expect(html.find("mythical-map-pin-dot")).toBeUndefined();
  });

  it("uses defaults: medium pin with map-pin glyph", () => {
    const r = setup();
    r.render(model([pin()]));
    const icon = iconOf(asMock(r.layerFor("ppin0001"))).options;
    expect(icon.iconSize).toEqual([32, 32]);
    const html = icon.html as FakeEl;
    expect(html.className).toContain("mythical-map-pin-pin");
    expect(html.find("mythical-map-pin-glyph")?.icon).toBe("map-pin");
  });

  it("centres circle pins and omits the shape for 'none'", () => {
    const r = setup();
    r.render(model([pin({ style: { iconShape: "circle" } }), pin({ id: "ppin0002", style: { iconShape: "none" } })]));
    expect(iconOf(asMock(r.layerFor("ppin0001"))).options.iconAnchor).toEqual([16, 16]);
    expect(htmlOf(asMock(r.layerFor("ppin0002"))).find("mythical-map-pin-shape")).toBeUndefined();
  });

  it("falls back to a dot for an unknown glyph", () => {
    const r = setup();
    r.render(model([pin({ style: { iconGlyph: "fa-dragon" } })]));
    const glyph = htmlOf(asMock(r.layerFor("ppin0001"))).find("mythical-map-pin-glyph");
    expect(glyph?.icon).toBeUndefined();
    expect(glyph?.find("mythical-map-pin-dot")).toBeDefined();
  });
});

describe("labels", () => {
  it("draws the name as text with size, colour and effect", () => {
    const r = setup();
    r.render(model([{ id: "llab0001", type: "label", rank: "a0", name: "The Wild Coast", pos: [-160, 32],
      style: { labelSize: "lg", textColor: "#203040", textEffect: "background", textEffectColor: "#FFEEDD" } }]));
    const l = asMock(r.layerFor("llab0001"));
    expect(l.kind).toBe("marker");
    expect(l.latlngs).toEqual([-160, 32]);
    const html = htmlOf(l);
    expect(html.textContent).toBe("The Wild Coast");
    expect(html.className).toBe("mythical-map-label mythical-map-text-lg mythical-map-text-effect-background");
    expect(html.styles["--mythical-map-text-color"]).toBe("#203040");
    expect(html.styles["--mythical-map-text-effect-color"]).toBe("#FFEEDD");
    expect(l.tooltip).toBeNull();
  });

  it("rebuilds the label icon when the text changes", () => {
    const r = setup();
    const label: Feature = { id: "llab0001", type: "label", rank: "a0", name: "A", pos: [0, 0] };
    r.render(model([label]));
    r.render(model([{ ...label, name: "B" }]));
    expect(htmlOf(asMock(r.layerFor("llab0001"))).textContent).toBe("B");
  });
});

describe("regions and paths", () => {
  it("maps line styles to dash arrays", () => {
    expect(dashArrayFor("solid", 3)).toBeUndefined();
    expect(dashArrayFor("none", 3)).toBeUndefined();
    expect(dashArrayFor("dashed", 4)).toBe("12 8");
    expect(dashArrayFor("dotted", 4)).toBe("1 8");
  });

  it("maps region fill and border styles", () => {
    const base = DEFAULT_STYLES.region;
    const solid = regionPathOptions({ ...base, color: "#2E7D32", fillOpacity: 0.35 });
    expect(solid).toMatchObject({ color: "#2E7D32", fillColor: "#2E7D32", fill: true, fillOpacity: 0.35, stroke: true, weight: 2 });
    expect(solid.dashArray).toBeUndefined();
    expect(regionPathOptions({ ...base, borderStyle: "dashed" }).dashArray).toBe("6 4");
    expect(regionPathOptions({ ...base, borderStyle: "dotted" })).toMatchObject({ dashArray: "1 4", lineCap: "round" });
    expect(regionPathOptions({ ...base, borderStyle: "none" })).toMatchObject({ stroke: false, weight: 0 });
    expect(regionPathOptions({ ...base, fillStyle: "none" })).toMatchObject({ fill: false, fillOpacity: 0 });
    expect(regionPathOptions({ ...base, fillStyle: "striped" }).className).toContain("mythical-map-fill-striped");
  });

  it("maps path stroke styles", () => {
    const opts = pathPathOptions({ ...DEFAULT_STYLES.path, color: "#8D6E63", strokeWidth: 4, strokeStyle: "dashed", strokeOpacity: 0.5 });
    expect(opts).toMatchObject({ color: "#8D6E63", weight: 4, opacity: 0.5, dashArray: "12 8", fill: false });
  });

  it("draws multi-polygon regions as separate polygons", () => {
    const r = setup();
    const a: [number, number][] = [[0, 0], [0, 1], [1, 1]];
    const b: [number, number][] = [[5, 5], [5, 6], [6, 6]];
    r.render(model([{ id: "rreg0001", type: "region", rank: "a0", polygons: [a, b] }]));
    const l = asMock(r.layerFor("rreg0001"));
    expect(l.kind).toBe("polygon");
    expect(l.latlngs).toEqual([[a], [b]]);
  });
});

describe("labelVisibility", () => {
  const named = (vis?: "always" | "hover" | "never") => pin({ name: "Westmarch", ...(vis ? { labelVisibility: vis } : {}) });

  it("always → permanent tooltip (the default)", () => {
    const r = setup();
    r.render(model([named()]));
    const t = asMock(r.layerFor("ppin0001")).tooltip;
    expect(t?.options.permanent).toBe(true);
    expect((t?.content as FakeEl).textContent).toBe("Westmarch");
  });

  it("hover → non-permanent tooltip", () => {
    const r = setup();
    r.render(model([named("hover")]));
    expect(asMock(r.layerFor("ppin0001")).tooltip?.options.permanent).toBe(false);
  });

  it("never, or no name → no tooltip", () => {
    const r = setup();
    r.render(model([named("never"), pin({ id: "ppin0002" })]));
    expect(asMock(r.layerFor("ppin0001")).tooltip).toBeNull();
    expect(asMock(r.layerFor("ppin0002")).tooltip).toBeNull();
  });

  it("rebinds when visibility or name changes, and unbinds for never", () => {
    const r = setup();
    r.render(model([named("always")]));
    r.render(model([named("hover")]));
    const l = asMock(r.layerFor("ppin0001"));
    expect(l.tooltip?.options.permanent).toBe(false);
    r.render(model([named("never")]));
    expect(l.tooltip).toBeNull();
    expect(l.callNames.filter((n) => n.endsWith("Tooltip"))).toEqual(["bindTooltip", "unbindTooltip", "bindTooltip", "unbindTooltip"]);
  });

  it("applies to regions and paths with their text style", () => {
    const r = setup();
    r.render(model([
      { id: "rreg0001", type: "region", rank: "a0", name: "Forest", labelVisibility: "hover", polygon: [[0, 0], [0, 1], [1, 1]],
        style: { textColor: "#112233" } },
      { id: "hpth0001", type: "path", rank: "a1", name: "Road", polyline: [[0, 0], [1, 1]] },
    ]));
    const rt = asMock(r.layerFor("rreg0001")).tooltip;
    expect(rt?.options).toMatchObject({ permanent: false, direction: "center" });
    expect((rt?.content as FakeEl).styles["--mythical-map-text-color"]).toBe("#112233");
    expect(asMock(r.layerFor("hpth0001")).tooltip?.options.permanent).toBe(true);
  });
});

describe("all-types fixture", () => {
  it("draws every non-folder feature at its stored coordinates", () => {
    const text = readFileSync(fileURLToPath(new URL("../test-vault/Maps/all-types.map", import.meta.url)), "utf8");
    const parsed = validateMap(JSON.parse(text));
    if (!parsed.ok) throw new Error("fixture invalid");
    const r = setup();
    r.render(parsed.map);
    const drawable = parsed.map.features.filter((f) => f.type !== "folder");
    expect(featureLayers).toHaveLength(drawable.length);
    for (const f of drawable) {
      const l = asMock(r.layerFor(f.id));
      if (f.type === "pin" || f.type === "label") expect(l.latlngs).toEqual(f.pos);
      if (f.type === "path") expect(l.latlngs).toEqual(f.polyline);
      if (f.type === "region") expect(l.latlngs).toEqual([f.polygon]);
    }
  });
});
