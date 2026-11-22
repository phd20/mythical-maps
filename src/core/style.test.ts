import { describe, expect, it } from "vitest";
import type { FolderFeature, LabelFeature, PathFeature, PinFeature, RegionFeature } from "./schema";
import { DEFAULT_STYLES, isValidHexColor, resolveStyle, type OverrideConfig } from "./style";

const DISABLED: OverrideConfig = { enabled: false };
const ENABLED: OverrideConfig = {
  enabled: true,
  iconProperty: "faction-icon",
  colorProperty: "faction-color",
  shapeProperty: "faction-shape",
};

const pin = (extra: Partial<PinFeature> = {}): PinFeature => ({
  id: "p1234567",
  type: "pin",
  rank: "a0",
  pos: [-10, 10],
  link: "Capital",
  ...extra,
});

describe("DEFAULT_STYLES", () => {
  it("matches the fresh-install defaults (medium pin coloured #A7A7A7)", () => {
    expect(DEFAULT_STYLES.pin).toEqual({ iconGlyph: "map-pin", iconColor: "#A7A7A7", iconShape: "pin", iconSize: "medium" });
    expect(DEFAULT_STYLES.label).toEqual({ labelSize: "md", textColor: "#FFFFFF", textEffect: "outline", textEffectColor: "#000000" });
    expect(DEFAULT_STYLES.region).toMatchObject({ color: "#3B82F6", fillOpacity: 0.3, fillStyle: "solid", borderStyle: "solid", labelSize: "md" });
    expect(DEFAULT_STYLES.path).toMatchObject({ color: "#3B82F6", strokeWidth: 3, strokeStyle: "solid", strokeOpacity: 1, textColor: "#FFFFFF" });
    expect(DEFAULT_STYLES.folder).toEqual({});
  });
});

describe("isValidHexColor", () => {
  it("accepts #RRGGBB in either case", () => {
    expect(isValidHexColor("#AA2233")).toBe(true);
    expect(isValidHexColor("#aa22ff")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of ["not-a-colour", "#ABC", "AA2233", "#AA22334", "#GG0000", "", 123, null, undefined]) {
      expect(isValidHexColor(v)).toBe(false);
    }
  });
});

describe("resolveStyle", () => {
  it("uses the defaults for an unstyled pin on a fresh install", () => {
    expect(resolveStyle(pin(), DEFAULT_STYLES, DISABLED)).toEqual(DEFAULT_STYLES.pin);
  });

  it("fills a partial style (only iconGlyph) from the defaults", () => {
    const style = resolveStyle(pin({ style: { iconGlyph: "castle" } }), DEFAULT_STYLES, ENABLED, {});
    expect(style).toEqual({ iconGlyph: "castle", iconColor: "#A7A7A7", iconShape: "pin", iconSize: "medium" });
  });

  it("prefers the stored style over defaults and ignores explicit undefined", () => {
    const style = resolveStyle(pin({ style: { iconColor: "#123456", iconSize: "small", iconShape: undefined } }), DEFAULT_STYLES, DISABLED);
    expect(style).toEqual({ iconGlyph: "map-pin", iconColor: "#123456", iconShape: "pin", iconSize: "small" });
  });

  it("applies a colour override from the linked note", () => {
    const f = pin({ style: { iconColor: "#111111" } });
    const style = resolveStyle(f, DEFAULT_STYLES, { enabled: true, colorProperty: "faction-color" }, { "faction-color": "#AA2233" });
    expect(style.iconColor).toBe("#AA2233");
    expect(f.style?.iconColor).toBe("#111111");
  });

  it("applies icon and shape overrides, unwrapping one-element list properties", () => {
    const style = resolveStyle(pin(), DEFAULT_STYLES, ENABLED, {
      "faction-icon": ["crown"],
      "faction-color": ["#00FF00"],
      "faction-shape": "shield",
    });
    expect(style).toEqual({ iconGlyph: "crown", iconColor: "#00FF00", iconShape: "shield", iconSize: "medium" });
  });

  it("uses the stored style when overrides are disabled", () => {
    const f = pin({ style: { iconColor: "#111111", iconGlyph: "tree" } });
    const fm = { "faction-color": "#AA2233", "faction-icon": "crown" };
    const style = resolveStyle(f, DEFAULT_STYLES, { ...ENABLED, enabled: false }, fm);
    expect(style).toEqual({ iconGlyph: "tree", iconColor: "#111111", iconShape: "pin", iconSize: "medium" });
  });

  it("falls through to the stored colour on an invalid override value", () => {
    const f = pin({ style: { iconColor: "#111111" } });
    expect(resolveStyle(f, DEFAULT_STYLES, ENABLED, { "faction-color": "not-a-colour" }).iconColor).toBe("#111111");
    expect(resolveStyle(f, DEFAULT_STYLES, ENABLED, { "faction-color": 42 }).iconColor).toBe("#111111");
    expect(resolveStyle(f, DEFAULT_STYLES, ENABLED, { "faction-color": ["#AA2233", "#BB3344"] }).iconColor).toBe("#111111");
  });

  it("rejects invalid icon and shape overrides", () => {
    const f = pin({ style: { iconGlyph: "tree", iconShape: "flag" } });
    const style = resolveStyle(f, DEFAULT_STYLES, ENABLED, { "faction-icon": "  ", "faction-shape": "hexagon" });
    expect(style.iconGlyph).toBe("tree");
    expect(style.iconShape).toBe("flag");
  });

  it("ignores an empty property name", () => {
    const fm = { "": "#AA2233", "faction-color": "#AA2233" };
    const style = resolveStyle(pin(), DEFAULT_STYLES, { enabled: true, colorProperty: "", iconProperty: "", shapeProperty: "" }, fm);
    expect(style).toEqual(DEFAULT_STYLES.pin);
  });

  it("ignores frontmatter for unlinked pins", () => {
    const style = resolveStyle(pin({ link: undefined }), DEFAULT_STYLES, ENABLED, { "faction-color": "#AA2233" });
    expect(style.iconColor).toBe("#A7A7A7");
  });

  it("ignores frontmatter for non-pin features", () => {
    const fm = { "faction-color": "#AA2233", color: "#AA2233", textColor: "#AA2233" };
    const cfg: OverrideConfig = { enabled: true, colorProperty: "color" };
    const label: LabelFeature = { id: "l1234567", type: "label", rank: "a1", pos: [0, 0] };
    const region: RegionFeature = { id: "r1234567", type: "region", rank: "a2", polygon: [[0, 0], [1, 1], [0, 1]] };
    const path: PathFeature = { id: "t1234567", type: "path", rank: "a3", polyline: [[0, 0], [1, 1]], style: { strokeWidth: 5 } };
    const folder: FolderFeature = { id: "f1234567", type: "folder", rank: "a4" };
    expect(resolveStyle(label, DEFAULT_STYLES, cfg, fm)).toEqual(DEFAULT_STYLES.label);
    expect(resolveStyle(region, DEFAULT_STYLES, cfg, fm)).toEqual(DEFAULT_STYLES.region);
    expect(resolveStyle(path, DEFAULT_STYLES, cfg, fm)).toEqual({ ...DEFAULT_STYLES.path, strokeWidth: 5 });
    expect(resolveStyle(folder, DEFAULT_STYLES, cfg, fm)).toEqual({});
  });

  it("uses custom plugin defaults for the feature type", () => {
    const defaults = { ...DEFAULT_STYLES, pin: { ...DEFAULT_STYLES.pin, iconColor: "#FF0000", iconShape: "circle" as const } };
    expect(resolveStyle(pin(), defaults, DISABLED)).toMatchObject({ iconColor: "#FF0000", iconShape: "circle" });
  });

  it("never mutates the feature or the defaults", () => {
    const f = pin({ style: { iconGlyph: "tree" } });
    const before = structuredClone(f);
    const defaultsBefore = structuredClone(DEFAULT_STYLES);
    const style = resolveStyle(f, DEFAULT_STYLES, ENABLED, { "faction-color": "#AA2233", "faction-icon": "crown" });
    style.iconSize = "small";
    expect(f).toEqual(before);
    expect(DEFAULT_STYLES).toEqual(defaultsBefore);
  });
});
