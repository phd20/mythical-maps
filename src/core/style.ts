/**
 * Style resolution (design D9, spec plugin-settings "Style resolution order").
 *
 * Each style field resolves as: valid frontmatter override (pins only, when
 * enabled and configured) → the feature's stored style → the plugin default
 * for that feature type. Resolution is pure: the feature is never mutated and
 * overrides are never written back to the `.map` file.
 */
import {
  ICON_SHAPES,
  type Feature,
  type FolderFeature,
  type LabelFeature,
  type LabelStyle,
  type PathFeature,
  type PathStyle,
  type PinFeature,
  type PinStyle,
  type RegionFeature,
  type RegionStyle,
} from "./schema";

export type ResolvedPinStyle = Required<PinStyle>;
export type ResolvedLabelStyle = Required<LabelStyle>;
export type ResolvedRegionStyle = Required<RegionStyle>;
export type ResolvedPathStyle = Required<PathStyle>;
export type ResolvedFolderStyle = Record<string, never>;
export type ResolvedStyle =
  | ResolvedPinStyle
  | ResolvedLabelStyle
  | ResolvedRegionStyle
  | ResolvedPathStyle
  | ResolvedFolderStyle;

/** Plugin defaults, one fully-populated style per feature type. */
export interface StyleDefaults {
  pin: ResolvedPinStyle;
  label: ResolvedLabelStyle;
  region: ResolvedRegionStyle;
  path: ResolvedPathStyle;
  folder: ResolvedFolderStyle;
}

/** Frontmatter override settings (spec plugin-settings "Optional frontmatter style overrides"). */
export interface OverrideConfig {
  enabled: boolean;
  iconProperty?: string;
  colorProperty?: string;
  shapeProperty?: string;
}

/** Linked note frontmatter, as read by a `FrontmatterReader`. */
export type Frontmatter = Readonly<Record<string, unknown>>;

const TEXT_DEFAULTS = {
  labelSize: "md",
  textColor: "#FFFFFF",
  textEffect: "outline",
  textEffectColor: "#000000",
} as const satisfies ResolvedLabelStyle;

/** LegendKeeper's documented defaults. */
export const DEFAULT_STYLES: StyleDefaults = {
  pin: { iconGlyph: "map-pin", iconColor: "#A7A7A7", iconShape: "pin", iconSize: "medium" },
  label: { ...TEXT_DEFAULTS },
  region: { color: "#3B82F6", fillOpacity: 0.3, fillStyle: "solid", borderStyle: "solid", ...TEXT_DEFAULTS },
  path: { color: "#3B82F6", strokeWidth: 3, strokeStyle: "solid", strokeOpacity: 1, ...TEXT_DEFAULTS },
  folder: {},
};

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** True for a `#RRGGBB` colour string. */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

const isIconShape = (value: unknown): value is (typeof ICON_SHAPES)[number] =>
  typeof value === "string" && (ICON_SHAPES as readonly string[]).includes(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Copy of `defaults` with every defined field of `stored` laid over it. */
function merge<T extends object>(defaults: T, stored: Partial<T> | undefined): T {
  const out = { ...defaults };
  if (stored) {
    for (const key of Object.keys(stored) as (keyof T)[]) {
      const value = stored[key];
      if (value !== undefined) out[key] = value as T[keyof T];
    }
  }
  return out;
}

/**
 * Read an override value: `frontmatter[property]`, unwrapping a one-element
 * array (Obsidian list properties). Returns `undefined` when the property
 * name is not configured.
 */
function readOverride(frontmatter: Frontmatter, property: string | undefined): unknown {
  if (typeof property !== "string" || property.trim() === "") return undefined;
  if (!Object.prototype.hasOwnProperty.call(frontmatter, property)) return undefined;
  const value = frontmatter[property];
  return Array.isArray(value) && value.length === 1 ? (value[0] as unknown) : value;
}

function applyPinOverrides(style: ResolvedPinStyle, config: OverrideConfig, frontmatter: Frontmatter): ResolvedPinStyle {
  const out = { ...style };
  const icon = readOverride(frontmatter, config.iconProperty);
  if (isNonEmptyString(icon)) out.iconGlyph = icon.trim();
  const color = readOverride(frontmatter, config.colorProperty);
  if (isValidHexColor(color)) out.iconColor = color;
  const shape = readOverride(frontmatter, config.shapeProperty);
  if (isIconShape(shape)) out.iconShape = shape;
  return out;
}

/**
 * Resolve a feature's fully-populated style. `frontmatter` is the linked
 * note's frontmatter; it is used only for linked pins, and only when
 * `overrides.enabled` is set and the matching property name is configured.
 * Invalid override values fall through to the stored style.
 */
export function resolveStyle(feature: PinFeature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedPinStyle;
export function resolveStyle(feature: LabelFeature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedLabelStyle;
export function resolveStyle(feature: RegionFeature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedRegionStyle;
export function resolveStyle(feature: PathFeature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedPathStyle;
export function resolveStyle(feature: FolderFeature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedFolderStyle;
export function resolveStyle(feature: Feature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedStyle;
export function resolveStyle(feature: Feature, defaults: StyleDefaults, overrides: OverrideConfig, frontmatter?: Frontmatter): ResolvedStyle {
  switch (feature.type) {
    case "pin": {
      const style = merge(defaults.pin, feature.style);
      const linked = typeof feature.link === "string" && feature.link.length > 0;
      if (!overrides.enabled || !linked || !frontmatter) return style;
      return applyPinOverrides(style, overrides, frontmatter);
    }
    case "label":
      return merge(defaults.label, feature.style);
    case "region":
      return merge(defaults.region, feature.style);
    case "path":
      return merge(defaults.path, feature.style);
    case "folder":
      return { ...defaults.folder };
  }
}
