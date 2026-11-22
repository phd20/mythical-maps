import { describe, expect, it } from "vitest";
import { update } from "./features";
import { buildPatch, buildRangePatch, fieldsFor, fieldValue, rangeValue, validateField, validateRange } from "./properties";
import { FEATURE_TYPES, validateMap, type Feature, type MapDocument } from "./schema";

const spec = (type: Feature["type"], key: string) => {
  const s = fieldsFor(type).find((f) => f.key === key);
  if (!s) throw new Error(`no field ${key}`);
  return s;
};

const pin = { id: "pinaaaaa", type: "pin", rank: "a0", pos: [1, 2], name: "Inn", style: { iconColor: "#112233" } } as Feature;
const doc = (features: unknown[]): MapDocument =>
  ({ type: "mythical-map", version: 1, image: { path: "a.png", width: 10, height: 10 }, features }) as MapDocument;

describe("fieldsFor", () => {
  it("lists per-type fields", () => {
    const keys = (t: Feature["type"]) => fieldsFor(t).map((f) => f.key);
    expect(keys("pin")).toEqual(["name", "link", "iconGlyph", "iconColor", "iconShape", "iconSize", "labelVisibility", "isHidden"]);
    expect(keys("folder")).toEqual(["name", "isHidden"]);
    expect(keys("region")).toContain("fillOpacity");
    expect(keys("path")).toContain("strokeWidth");
    expect(keys("label")).toContain("textColor");
  });

  it("only names style keys the schema accepts for that type", () => {
    for (const type of FEATURE_TYPES) {
      const base: Record<string, unknown> = { id: "abcdefgh", type, rank: "a0" };
      if (type === "pin" || type === "label") base.pos = [0, 0];
      if (type === "region") base.polygon = [[0, 0], [0, 1], [1, 1]];
      if (type === "path") base.polyline = [[0, 0], [1, 1]];
      const sample: Record<string, unknown> = { fillOpacity: 0.5, strokeOpacity: 0.5, strokeWidth: 2, iconGlyph: "x" };
      for (const s of fieldsFor(type).filter((f) => f.scope === "style")) {
        const value = s.kind === "enum" ? s.options?.[0] : (sample[s.key] ?? "#000000");
        const result = validateMap(doc([{ ...base, style: { [s.key]: value } }]));
        expect(result.ok, `${type}.${s.key}`).toBe(true);
      }
    }
  });
});

describe("validateField", () => {
  it("accepts #RRGGBB and rejects anything else for colours", () => {
    const s = spec("pin", "iconColor");
    expect(validateField(s, " #A1b2C3 ")).toEqual({ ok: true, value: "#A1b2C3" });
    for (const bad of ["red", "#fff", "#12345", "112233", "#GGGGGG"]) expect(validateField(s, bad).ok, bad).toBe(false);
  });

  it("clears blank text, colour and enum fields", () => {
    expect(validateField(spec("pin", "name"), "   ")).toEqual({ ok: true, value: undefined });
    expect(validateField(spec("pin", "iconColor"), "")).toEqual({ ok: true, value: undefined });
    expect(validateField(spec("pin", "iconShape"), "")).toEqual({ ok: true, value: undefined });
  });

  it("trims names and validates enums", () => {
    expect(validateField(spec("pin", "name"), "  Tavern ")).toEqual({ ok: true, value: "Tavern" });
    expect(validateField(spec("pin", "iconShape"), "flag")).toEqual({ ok: true, value: "flag" });
    expect(validateField(spec("pin", "iconShape"), "blob").ok).toBe(false);
  });

  it("checks number ranges", () => {
    const opacity = spec("region", "fillOpacity");
    expect(validateField(opacity, "0.5")).toEqual({ ok: true, value: 0.5 });
    expect(validateField(opacity, "0")).toEqual({ ok: true, value: 0 });
    expect(validateField(opacity, "1.5").ok).toBe(false);
    expect(validateField(opacity, "-0.1").ok).toBe(false);
    expect(validateField(opacity, "abc").ok).toBe(false);
    expect(validateField(opacity, "NaN").ok).toBe(false);
    const width = spec("path", "strokeWidth");
    expect(validateField(width, "4")).toEqual({ ok: true, value: 4 });
    expect(validateField(width, "0").ok).toBe(false);
    expect(validateField(width, "-2").ok).toBe(false);
  });

  it("maps checkboxes to true or a cleared key", () => {
    const hidden = spec("pin", "isHidden");
    expect(validateField(hidden, true)).toEqual({ ok: true, value: true });
    expect(validateField(hidden, false)).toEqual({ ok: true, value: undefined });
  });
});

describe("validateRange", () => {
  it("accepts a valid range and clears when both are blank", () => {
    expect(validateRange("0.2", "0.8")).toEqual({ ok: true, value: [0.2, 0.8] });
    expect(validateRange("0", "1")).toEqual({ ok: true, value: [0, 1] });
    expect(validateRange("0.5", "0.5")).toEqual({ ok: true, value: [0.5, 0.5] });
    expect(validateRange("", " ")).toEqual({ ok: true, value: undefined });
  });

  it("rejects out-of-range, inverted, partial and non-numeric input", () => {
    expect(validateRange("0.8", "0.2").ok).toBe(false);
    expect(validateRange("-0.1", "0.5").ok).toBe(false);
    expect(validateRange("0.1", "1.5").ok).toBe(false);
    expect(validateRange("0.1", "").ok).toBe(false);
    expect(validateRange("a", "b").ok).toBe(false);
  });
});

describe("fieldValue / rangeValue", () => {
  it("reads stored values as form text", () => {
    expect(fieldValue(pin, spec("pin", "name"))).toBe("Inn");
    expect(fieldValue(pin, spec("pin", "iconColor"))).toBe("#112233");
    expect(fieldValue(pin, spec("pin", "iconShape"))).toBe("");
    expect(fieldValue(pin, spec("pin", "isHidden"))).toBe(false);
    expect(rangeValue(pin)).toEqual(["", ""]);
    expect(rangeValue({ ...pin, visibilityRange: [0.1, 0.9] } as Feature)).toEqual(["0.1", "0.9"]);
  });
});

describe("buildPatch", () => {
  it("patches feature and style fields through update", () => {
    const renamed = update(doc([pin]), pin.id, buildPatch(pin, spec("pin", "name"), "Tavern"));
    expect(renamed.ok && renamed.map.features[0]?.name).toBe("Tavern");
    const shaped = update(doc([pin]), pin.id, buildPatch(pin, spec("pin", "iconShape"), "flag"));
    expect(shaped.ok && shaped.map.features[0]?.style).toEqual({ iconColor: "#112233", iconShape: "flag" });
  });

  it("removes keys when cleared, and style when it empties", () => {
    const noName = update(doc([pin]), pin.id, buildPatch(pin, spec("pin", "name"), undefined));
    expect(noName.ok && "name" in (noName.map.features[0] ?? {})).toBe(false);
    const noColor = update(doc([pin]), pin.id, buildPatch(pin, spec("pin", "iconColor"), undefined));
    expect(noColor.ok && "style" in (noColor.map.features[0] ?? {})).toBe(false);
  });

  it("sets and clears visibilityRange", () => {
    const set = update(doc([pin]), pin.id, buildRangePatch([0.1, 0.9]));
    expect(set.ok && set.map.features[0]?.visibilityRange).toEqual([0.1, 0.9]);
    const withRange = { ...pin, visibilityRange: [0.1, 0.9] } as Feature;
    const cleared = update(doc([withRange]), pin.id, buildRangePatch(undefined));
    expect(cleared.ok && "visibilityRange" in (cleared.map.features[0] ?? {})).toBe(false);
  });
});
