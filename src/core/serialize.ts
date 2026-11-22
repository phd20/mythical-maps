/**
 * Deterministic serialization (design D2, spec map-file "Deterministic
 * serialization").
 *
 * `stringifyMap` writes a map in canonical form: 2-space indent, a fixed key
 * order, features sorted by `(parentId, rank, id)`, coordinate pairs on one
 * line (`[a, b]`), vertex lists one vertex per line, and a trailing newline.
 * The output is plain JSON, so `JSON.parse` reads it back to an equal object,
 * and serializing that again gives byte-identical text.
 *
 * Parsing text (and migration) lives in `parse.ts`.
 */
import {
  folderStyleSchema,
  labelStyleSchema,
  pathStyleSchema,
  pinStyleSchema,
  regionStyleSchema,
  type Feature,
  type FeatureType,
  type MapDocument,
} from "./schema";

const INDENT = "  ";

export const DOCUMENT_KEY_ORDER = ["type", "version", "image", "viewport", "features"] as const;
export const IMAGE_KEY_ORDER = ["path", "width", "height"] as const;
export const VIEWPORT_KEY_ORDER = ["center", "zoom"] as const;
export const FEATURE_KEY_ORDER = [
  "id",
  "type",
  "name",
  "parentId",
  "rank",
  "isHidden",
  "pos",
  "polygon",
  "polygons",
  "polyline",
  "link",
  "visibilityRange",
  "labelVisibility",
  "style",
] as const;

/** Style key order per feature type: the order the keys are declared in `schema.ts`. */
export const STYLE_KEY_ORDER: Readonly<Record<FeatureType, readonly string[]>> = {
  pin: Object.keys(pinStyleSchema.shape),
  label: Object.keys(labelStyleSchema.shape),
  region: Object.keys(regionStyleSchema.shape),
  path: Object.keys(pathStyleSchema.shape),
  folder: Object.keys(folderStyleSchema.shape),
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Plain code-unit comparison (fractional-indexing ranks are ordered by code unit, not locale). */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Feature order: `parentId` (missing sorts first, as `""`), then `rank`, then
 * `id`. Returns a new array; the input is not changed.
 */
export function sortFeatures<T extends Pick<Feature, "id" | "rank" | "parentId">>(features: readonly T[]): T[] {
  return [...features].sort(
    (a, b) =>
      compareStrings(a.parentId ?? "", b.parentId ?? "") || compareStrings(a.rank, b.rank) || compareStrings(a.id, b.id),
  );
}

/**
 * Copy `obj` with its keys in `order`, dropping `undefined` values. Keys not
 * in `order` follow, alphabetically, so nothing is ever lost.
 */
function ordered(obj: Record<string, unknown>, order: readonly string[]): [string, unknown][] {
  const known = new Set(order);
  const extra = Object.keys(obj)
    .filter((k) => !known.has(k))
    .sort(compareStrings);
  return [...order, ...extra].filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]);
}

/** Generic canonical form for values outside the known structure: keys sorted alphabetically. */
function canonicalUnknown(value: unknown): Json {
  if (Array.isArray(value)) return value.map(canonicalUnknown);
  if (isRecord(value)) return Object.fromEntries(ordered(value, []).map(([k, v]) => [k, canonicalUnknown(v)]));
  return value as Json;
}

function canonicalObject(obj: Record<string, unknown>, order: readonly string[], nested: Record<string, (v: unknown) => Json> = {}): Json {
  return Object.fromEntries(ordered(obj, order).map(([k, v]) => [k, (nested[k] ?? canonicalUnknown)(v)]));
}

function canonicalFeature(feature: Record<string, unknown>): Json {
  const styleOrder = STYLE_KEY_ORDER[feature.type as FeatureType] ?? [];
  return canonicalObject(feature, FEATURE_KEY_ORDER, {
    style: (v) => (isRecord(v) ? canonicalObject(v, styleOrder) : canonicalUnknown(v)),
  });
}

/** Reorder a document into canonical key and feature order (as a plain JSON tree). */
function canonicalDocument(map: MapDocument): Json {
  const doc = map as unknown as Record<string, unknown>;
  return canonicalObject(doc, DOCUMENT_KEY_ORDER, {
    image: (v) => (isRecord(v) ? canonicalObject(v, IMAGE_KEY_ORDER) : canonicalUnknown(v)),
    viewport: (v) => (isRecord(v) ? canonicalObject(v, VIEWPORT_KEY_ORDER) : canonicalUnknown(v)),
    features: (v) =>
      Array.isArray(v) ? sortFeatures(v as Feature[]).map((f) => (isRecord(f) ? canonicalFeature(f) : canonicalUnknown(f))) : canonicalUnknown(v),
  });
}

const isScalarArray = (v: Json[]): boolean => v.every((x) => x === null || typeof x !== "object");

/**
 * Emit JSON text. Arrays of scalars (coordinate pairs, `visibilityRange`) go on
 * one line as `[a, b]`; any other non-empty array or object puts one element
 * per line. Numbers use JSON's shortest round-trip form.
 */
function emit(value: Json, indent: string): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const inner = indent + INDENT;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (isScalarArray(value)) return `[${value.map((x) => emit(x, inner)).join(", ")}]`;
    return `[\n${value.map((x) => inner + emit(x, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${emit(v, inner)}`).join(",\n")}\n${indent}}`;
}

/** Serialize a map in canonical form (see module doc). */
export function stringifyMap(map: MapDocument): string {
  return emit(canonicalDocument(map), "") + "\n";
}
