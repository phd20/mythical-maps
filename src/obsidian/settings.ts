/**
 * Plugin settings (spec plugin-settings "Settings tab", design D8/D9).
 *
 * Settings persist in the plugin's `data.json` and hold no map data. Loading
 * is defensive: `mergeSettings` lays whatever was stored over the defaults,
 * keeping only known keys with valid values.
 */
import { ICON_SHAPES, ICON_SIZES } from "../core/schema";
import { DEFAULT_STYLES, isValidHexColor, type OverrideConfig, type ResolvedPinStyle } from "../core/style";

export interface OverrideSettings {
  enabled: boolean;
  iconProperty: string;
  colorProperty: string;
  shapeProperty: string;
}

export interface MythicalMapsSettings {
  /** Frontmatter property listing a note's `.map` files (drill-down, D8). */
  mapsProperty: string;
  /** Optional frontmatter style overrides for linked pins (D9). */
  overrides: OverrideSettings;
  /** Style used for any pin field the `.map` file does not store. */
  defaultPinStyle: ResolvedPinStyle;
  /** Set once the sidebar panel has been added, so a closed panel stays closed. */
  panelAdded: boolean;
  settingsVersion: 1;
}

export const DEFAULT_SETTINGS: MythicalMapsSettings = {
  mapsProperty: "maps",
  overrides: { enabled: false, iconProperty: "", colorProperty: "", shapeProperty: "" },
  defaultPinStyle: { ...DEFAULT_STYLES.pin },
  panelAdded: false,
  settingsVersion: 1,
};

type Shape = ResolvedPinStyle["iconShape"];
type Size = ResolvedPinStyle["iconSize"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export const isIconShape = (value: unknown): value is Shape =>
  typeof value === "string" && (ICON_SHAPES as readonly string[]).includes(value);

export const isIconSize = (value: unknown): value is Size =>
  typeof value === "string" && (ICON_SIZES as readonly string[]).includes(value);

const stringOr = (value: unknown, fallback: string): string => (typeof value === "string" ? value.trim() : fallback);

/**
 * Build a complete settings object from whatever `loadData()` returned
 * (`null` on a fresh install). Unknown keys are dropped; a missing or
 * wrong-typed value (including an invalid colour, shape or size, or an empty
 * maps property or glyph) falls back to its default. Never throws.
 */
export function mergeSettings(loaded: unknown): MythicalMapsSettings {
  const src = isRecord(loaded) ? loaded : {};
  const ov = isRecord(src.overrides) ? src.overrides : {};
  const pin = isRecord(src.defaultPinStyle) ? src.defaultPinStyle : {};
  const d = DEFAULT_SETTINGS;

  return {
    mapsProperty: isNonEmptyString(src.mapsProperty) ? src.mapsProperty.trim() : d.mapsProperty,
    overrides: {
      enabled: typeof ov.enabled === "boolean" ? ov.enabled : d.overrides.enabled,
      iconProperty: stringOr(ov.iconProperty, d.overrides.iconProperty),
      colorProperty: stringOr(ov.colorProperty, d.overrides.colorProperty),
      shapeProperty: stringOr(ov.shapeProperty, d.overrides.shapeProperty),
    },
    defaultPinStyle: {
      iconGlyph: isNonEmptyString(pin.iconGlyph) ? pin.iconGlyph.trim() : d.defaultPinStyle.iconGlyph,
      iconColor: isValidHexColor(pin.iconColor) ? pin.iconColor : d.defaultPinStyle.iconColor,
      iconShape: isIconShape(pin.iconShape) ? pin.iconShape : d.defaultPinStyle.iconShape,
      iconSize: isIconSize(pin.iconSize) ? pin.iconSize : d.defaultPinStyle.iconSize,
    },
    panelAdded: src.panelAdded === true,
    settingsVersion: 1,
  };
}

/** The core `OverrideConfig` for these settings; empty property names become `undefined`. */
export function toOverrideConfig(settings: MythicalMapsSettings): OverrideConfig {
  const name = (value: string): string | undefined => (value.trim() === "" ? undefined : value.trim());
  return {
    enabled: settings.overrides.enabled,
    iconProperty: name(settings.overrides.iconProperty),
    colorProperty: name(settings.overrides.colorProperty),
    shapeProperty: name(settings.overrides.shapeProperty),
  };
}
