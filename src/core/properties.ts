/**
 * Properties form model (bead 5.5, spec map-editing "Select and edit
 * properties"): which fields each feature type shows, how raw form input is
 * validated, and the `update` patch an accepted value turns into.
 *
 * Pure: no DOM. The UI (`ui/propertiesForm.ts`) renders `fieldsFor(type)`,
 * calls `validateField` / `validateRange` on input, and only sends
 * `buildPatch` through the view's `edit()` when validation passes, so an
 * invalid entry never reaches the stored map.
 */
import { DEFAULT_NAMES } from "./create";
import type { FeaturePatch } from "./features";
import { splitLinktext } from "./links";
import {
  BORDER_STYLES,
  FILL_STYLES,
  ICON_SHAPES,
  ICON_SIZES,
  LABEL_SIZES,
  LABEL_VISIBILITIES,
  STROKE_STYLES,
  TEXT_EFFECTS,
  type Feature,
  type FeatureType,
} from "./schema";
import { isValidHexColor } from "./style";

export type FieldKind = "text" | "color" | "enum" | "number" | "boolean";

export interface FieldSpec {
  /** Key on the feature (`scope: "feature"`) or on `feature.style` (`scope: "style"`). */
  key: string;
  label: string;
  kind: FieldKind;
  scope: "feature" | "style";
  /** Allowed values for `enum` fields. */
  options?: readonly string[];
  /** Inclusive bounds for `number` fields. */
  min?: number;
  max?: number;
  /** `number` fields: the value must be greater than 0 (stroke width). */
  positive?: boolean;
}

/** A form value: text for most fields, a boolean for checkboxes. */
export type RawValue = string | boolean;

export type FieldResult = { ok: true; value: unknown } | { ok: false; error: string };

export type RangeValue = [number, number];
export type RangeResult = { ok: true; value: RangeValue | undefined } | { ok: false; error: string };

const feat = (key: string, label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  kind,
  scope: "feature",
  ...extra,
});
const sty = (key: string, label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key,
  label,
  kind,
  scope: "style",
  ...extra,
});
const en = (options: readonly string[]) => ({ options });
const unit = { min: 0, max: 1 };

const TEXT_FIELDS: FieldSpec[] = [
  sty("labelSize", "Label size", "enum", en(LABEL_SIZES)),
  sty("textColor", "Text colour", "color"),
  sty("textEffect", "Text effect", "enum", en(TEXT_EFFECTS)),
  sty("textEffectColor", "Text effect colour", "color"),
];

const NAME = feat("name", "Name", "text");
const LABEL_VISIBILITY = feat("labelVisibility", "Label visibility", "enum", en(LABEL_VISIBILITIES));
const IS_HIDDEN = feat("isHidden", "Hidden", "boolean");

/** The editable fields for a feature type, in display order. `visibilityRange` is separate (`validateRange`). */
export function fieldsFor(type: FeatureType): FieldSpec[] {
  switch (type) {
    case "pin":
      return [
        NAME,
        feat("link", "Link", "text"),
        sty("iconGlyph", "Icon", "text"),
        sty("iconColor", "Icon colour", "color"),
        sty("iconShape", "Icon shape", "enum", en(ICON_SHAPES)),
        sty("iconSize", "Icon size", "enum", en(ICON_SIZES)),
        LABEL_VISIBILITY,
        IS_HIDDEN,
      ];
    case "label":
      return [NAME, ...TEXT_FIELDS, LABEL_VISIBILITY, IS_HIDDEN];
    case "region":
      return [
        NAME,
        sty("color", "Colour", "color"),
        sty("fillOpacity", "Fill opacity", "number", unit),
        sty("fillStyle", "Fill style", "enum", en(FILL_STYLES)),
        sty("borderStyle", "Border style", "enum", en(BORDER_STYLES)),
        ...TEXT_FIELDS,
        LABEL_VISIBILITY,
        IS_HIDDEN,
      ];
    case "path":
      return [
        NAME,
        sty("color", "Colour", "color"),
        sty("strokeWidth", "Stroke width", "number", { positive: true }),
        sty("strokeStyle", "Stroke style", "enum", en(STROKE_STYLES)),
        sty("strokeOpacity", "Stroke opacity", "number", unit),
        ...TEXT_FIELDS,
        LABEL_VISIBILITY,
        IS_HIDDEN,
      ];
    case "folder":
      return [NAME, IS_HIDDEN];
  }
}

/** The field's stored value as form text (booleans as booleans); "" when unset. */
export function fieldValue(feature: Feature, spec: FieldSpec): RawValue {
  const source = (spec.scope === "style" ? feature.style : feature) as Record<string, unknown> | undefined;
  const value = source?.[spec.key];
  if (spec.kind === "boolean") return value === true;
  return value === undefined ? "" : String(value);
}

/**
 * Validate raw form input for a field. A blank value on a non-boolean field
 * clears it (`value: undefined`, meaning "use the default"). Failures carry a
 * message for the inline error; the caller must not edit the map then.
 */
export function validateField(spec: FieldSpec, raw: RawValue): FieldResult {
  if (spec.kind === "boolean") return { ok: true, value: raw === true ? true : undefined };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return { ok: true, value: undefined };
  switch (spec.kind) {
    case "text":
      return { ok: true, value: text };
    case "color":
      return isValidHexColor(text) ? { ok: true, value: text } : { ok: false, error: "Enter a colour as #RRGGBB, e.g. #3B82F6" };
    case "enum":
      return spec.options?.includes(text) ? { ok: true, value: text } : { ok: false, error: `Choose one of: ${spec.options?.join(", ") ?? ""}` };
    case "number": {
      const n = parseNumber(text);
      if (n === undefined) return { ok: false, error: "Enter a number" };
      if (spec.positive === true && n <= 0) return { ok: false, error: "Must be greater than 0" };
      if (spec.min !== undefined && spec.max !== undefined && (n < spec.min || n > spec.max)) {
        return { ok: false, error: `Must be between ${spec.min} and ${spec.max}` };
      }
      return { ok: true, value: n };
    }
  }
}

/** Number text as a finite number, else undefined. */
function parseNumber(text: string): number | undefined {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Validate the two `visibilityRange` inputs together: both blank clears the
 * range; otherwise both must be numbers in 0-1 with min ≤ max.
 */
export function validateRange(minRaw: string, maxRaw: string): RangeResult {
  const minText = minRaw.trim();
  const maxText = maxRaw.trim();
  if (minText === "" && maxText === "") return { ok: true, value: undefined };
  if (minText === "" || maxText === "") return { ok: false, error: "Enter both a minimum and a maximum, or clear both" };
  const min = parseNumber(minText);
  const max = parseNumber(maxText);
  if (min === undefined || max === undefined) return { ok: false, error: "Enter numbers between 0 and 1" };
  if (min < 0 || min > 1 || max < 0 || max > 1) return { ok: false, error: "Values must be between 0 and 1" };
  if (min > max) return { ok: false, error: "Minimum must not be greater than maximum" };
  return { ok: true, value: [min, max] };
}

/** The `visibilityRange` as two form strings ("" when unset). */
export function rangeValue(feature: Feature): [string, string] {
  const range = feature.visibilityRange;
  return range ? [String(range[0]), String(range[1])] : ["", ""];
}

/** The `update` patch that sets `spec` to a validated `value` (`undefined` clears it). */
export function buildPatch(feature: Feature, spec: FieldSpec, value: unknown): FeaturePatch {
  if (spec.scope === "feature") return { [spec.key]: value };
  // Style keys merge one level deep; drop `style` entirely when its last key is cleared.
  const remaining = Object.entries(feature.style ?? {}).filter(([k, v]) => k !== spec.key && v !== undefined);
  if (value === undefined && remaining.length === 0) return { style: undefined };
  return { style: { [spec.key]: value } };
}

/** The note's name from a linktext: no folders, no `#subpath`, no `.md`. */
export function noteNameFromLinktext(linktext: string): string {
  const { path } = splitLinktext(linktext);
  return (path.split("/").pop() ?? "").replace(/\.md$/i, "").trim();
}

/**
 * The `update` patch for a note chosen from a picker (`null` clears the link).
 * A pin with no name (blank, or still the one it was created with) also takes
 * the note's name, so both change in one edit; a chosen name is never replaced.
 */
export function linkPatch(feature: Feature, linktext: string | null): FeaturePatch {
  if (linktext === null) return { link: undefined };
  const name = noteNameFromLinktext(linktext);
  const current = (feature.name ?? "").trim();
  const unnamed = current === "" || current === DEFAULT_NAMES.pin;
  return unnamed && name !== "" ? { link: linktext, name } : { link: linktext };
}

/** The `update` patch for a validated `visibilityRange`. */
export function buildRangePatch(range: RangeValue | undefined): FeaturePatch {
  return { visibilityRange: range };
}
