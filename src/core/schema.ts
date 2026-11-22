/**
 * Map schema v1 (design D2, spec map-file "Feature model").
 *
 * The zod schema checks the shape of a `.map` document; `checkFeatureRefs`
 * adds the cross-feature rules (unique ids, `parentId` names a folder, no
 * folder cycles). `validateMap` runs both and reports every issue with a
 * dotted JSON path such as `features.3.pos`.
 *
 * Parsing JSON text, migration and serialization live in other modules.
 */
import { z } from "zod";

export const MAP_TYPE = "mythical-map" as const;
export const CURRENT_VERSION = 1 as const;

/** 8-char id (`ids.ts`) or 24-char cuid2 (LegendKeeper compatibility). */
export const FEATURE_ID_PATTERN = /^[a-z](?:[0-9a-z]{7}|[0-9a-z]{23})$/;

export const FEATURE_TYPES = ["pin", "label", "region", "path", "folder"] as const;
export const ICON_SHAPES = ["pin", "diamond", "flag", "marker", "shield", "circle", "banner", "arch", "none"] as const;
export const ICON_SIZES = ["medium", "small"] as const;
export const LABEL_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"] as const;
export const TEXT_EFFECTS = ["outline", "background"] as const;
export const LABEL_VISIBILITIES = ["always", "hover", "never"] as const;
export const FILL_STYLES = ["solid", "striped", "dotted", "none"] as const;
export const BORDER_STYLES = ["solid", "dashed", "dotted", "none"] as const;
export const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;

/** Message for a missing required field; other failures keep zod's default message. */
const requiredError = (field: string) => (issue: { input?: unknown }) =>
  issue.input === undefined ? `${field} is required` : undefined;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #RRGGBB colour");
const unit = z.number().min(0).max(1);

/** `[lat, lng]` in the LegendKeeper-compatible frame (see `frame.ts`). */
export const latLngSchema = z.tuple([z.number(), z.number()]);
export type LatLng = z.infer<typeof latLngSchema>;

const polygonSchema = z.array(latLngSchema).min(3, "a polygon needs at least 3 vertices");

export const visibilityRangeSchema = z
  .tuple([unit, unit])
  .refine(([min, max]) => min <= max, "visibilityRange min must be ≤ max");

const textStyleFields = {
  labelSize: z.enum(LABEL_SIZES).optional(),
  textColor: hexColor.optional(),
  textEffect: z.enum(TEXT_EFFECTS).optional(),
  textEffectColor: hexColor.optional(),
};

export const pinStyleSchema = z.strictObject({
  iconGlyph: z.string().min(1).optional(),
  iconColor: hexColor.optional(),
  iconShape: z.enum(ICON_SHAPES).optional(),
  iconSize: z.enum(ICON_SIZES).optional(),
});

export const labelStyleSchema = z.strictObject({ ...textStyleFields });

export const regionStyleSchema = z.strictObject({
  color: hexColor.optional(),
  fillOpacity: unit.optional(),
  fillStyle: z.enum(FILL_STYLES).optional(),
  borderStyle: z.enum(BORDER_STYLES).optional(),
  ...textStyleFields,
});

export const pathStyleSchema = z.strictObject({
  color: hexColor.optional(),
  strokeWidth: z.number().positive().optional(),
  strokeStyle: z.enum(STROKE_STYLES).optional(),
  strokeOpacity: unit.optional(),
  ...textStyleFields,
});

export const folderStyleSchema = z.strictObject({});

const commonFields = {
  id: z.string({ error: requiredError("id") }).regex(FEATURE_ID_PATTERN, "id must match ^[a-z][0-9a-z]{7}$ (or a 24-char cuid2)"),
  name: z.string().optional(),
  parentId: z.string().optional(),
  rank: z.string({ error: requiredError("rank") }).min(1, "rank must not be empty"),
  isHidden: z.boolean().optional(),
  visibilityRange: visibilityRangeSchema.optional(),
  labelVisibility: z.enum(LABEL_VISIBILITIES).optional(),
};

export const pinSchema = z.strictObject({
  ...commonFields,
  type: z.literal("pin"),
  pos: z.tuple([z.number(), z.number()], { error: requiredError("pos") }),
  link: z.string().min(1).optional(),
  style: pinStyleSchema.optional(),
});

export const labelSchema = z.strictObject({
  ...commonFields,
  type: z.literal("label"),
  pos: z.tuple([z.number(), z.number()], { error: requiredError("pos") }),
  style: labelStyleSchema.optional(),
});

/** Presence of `polygon` or `polygons` is checked by the refinement below. */
export const regionSchema = z
  .strictObject({
    ...commonFields,
    type: z.literal("region"),
    polygon: polygonSchema.optional(),
    polygons: z.array(polygonSchema).min(1, "polygons must not be empty").optional(),
    style: regionStyleSchema.optional(),
  })
  .refine((r) => r.polygon !== undefined || r.polygons !== undefined, {
    message: "region requires polygon or polygons",
    path: ["polygon"],
  });

export const pathSchema = z.strictObject({
  ...commonFields,
  type: z.literal("path"),
  polyline: z.array(latLngSchema, { error: requiredError("polyline") }).min(2, "a polyline needs at least 2 vertices"),
  style: pathStyleSchema.optional(),
});

export const folderSchema = z.strictObject({
  ...commonFields,
  type: z.literal("folder"),
  style: folderStyleSchema.optional(),
});

export const featureSchema = z.discriminatedUnion("type", [pinSchema, labelSchema, regionSchema, pathSchema, folderSchema], {
  error: (issue) =>
    issue.code === "invalid_union" ? `type must be one of ${FEATURE_TYPES.join(", ")}` : undefined,
});

export const imageSchema = z.strictObject(
  {
    path: z.string({ error: requiredError("path") }).min(1, "image path must not be empty"),
    width: z.number({ error: requiredError("width") }).int().positive(),
    height: z.number({ error: requiredError("height") }).int().positive(),
  },
  { error: requiredError("image") },
);

export const viewportSchema = z.strictObject({
  center: latLngSchema,
  zoom: z.number(),
});

/** Shape-only schema (no cross-feature checks). */
const documentShapeSchema = z.strictObject({
  type: z.literal(MAP_TYPE, { error: "not a Mythical map (type must be \"mythical-map\")" }),
  version: z.literal(CURRENT_VERSION, { error: `version must be ${CURRENT_VERSION}` }),
  image: imageSchema,
  viewport: viewportSchema.optional(),
  features: z.array(featureSchema, { error: requiredError("features") }),
});

export type PinFeature = z.infer<typeof pinSchema>;
export type LabelFeature = z.infer<typeof labelSchema>;
export type RegionFeature = z.infer<typeof regionSchema>;
export type PathFeature = z.infer<typeof pathSchema>;
export type FolderFeature = z.infer<typeof folderSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type FeatureType = Feature["type"];
export type PinStyle = z.infer<typeof pinStyleSchema>;
export type LabelStyle = z.infer<typeof labelStyleSchema>;
export type RegionStyle = z.infer<typeof regionStyleSchema>;
export type PathStyle = z.infer<typeof pathStyleSchema>;
export type MapImage = z.infer<typeof imageSchema>;
export type Viewport = z.infer<typeof viewportSchema>;
export type MapDocument = z.infer<typeof documentShapeSchema>;

export interface ValidationIssue {
  /** Dotted JSON path, e.g. `features.3.pos`; `""` for the document root. */
  path: string;
  message: string;
}

export type ValidationResult = { ok: true; map: MapDocument } | { ok: false; issues: ValidationIssue[] };

interface RefIssue {
  path: (string | number)[];
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Cross-feature checks: duplicate ids, `parentId` must name an existing
 * folder, and folders must not form a cycle. Works on untrusted input and
 * only looks at features whose `id`/`type`/`parentId` are strings, so it can
 * run alongside the shape check and report every issue at once.
 */
export function checkFeatureRefs(features: unknown): RefIssue[] {
  if (!Array.isArray(features)) return [];
  const issues: RefIssue[] = [];
  const byId = new Map<string, { index: number; type: unknown; parentId: unknown }>();

  features.forEach((f, index) => {
    if (!isRecord(f) || typeof f.id !== "string") return;
    if (byId.has(f.id)) {
      issues.push({ path: ["features", index, "id"], message: `Duplicate feature id "${f.id}"` });
      return;
    }
    byId.set(f.id, { index, type: f.type, parentId: f.parentId });
  });

  features.forEach((f, index) => {
    if (!isRecord(f) || typeof f.id !== "string" || typeof f.parentId !== "string") return;
    const path = ["features", index, "parentId"];
    const parent = byId.get(f.parentId);
    if (!parent) {
      issues.push({ path, message: `Feature "${f.id}": parentId "${f.parentId}" does not name an existing feature` });
    } else if (parent.type !== "folder") {
      issues.push({ path, message: `Feature "${f.id}": parentId "${f.parentId}" must name a folder, not a ${String(parent.type)}` });
    }
  });

  // Folder cycles (including self-parenting): walk up from each folder.
  for (const [id, entry] of byId) {
    if (entry.type !== "folder") continue;
    const seen = new Set<string>([id]);
    let cur = entry.parentId;
    while (typeof cur === "string") {
      if (cur === id) {
        issues.push({ path: ["features", entry.index, "parentId"], message: `Feature "${id}": parentId creates a folder cycle` });
        break;
      }
      if (seen.has(cur)) break; // cycle not through this folder; reported from its members
      seen.add(cur);
      const next = byId.get(cur);
      if (!next || next.type !== "folder") break;
      cur = next.parentId;
    }
  }
  return issues;
}

/** Full document schema: shape plus cross-feature checks. */
export const mapDocumentSchema = documentShapeSchema.superRefine((doc, ctx) => {
  for (const issue of checkFeatureRefs(doc.features)) {
    ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
  }
});

const pathToString = (path: readonly PropertyKey[]): string => path.map(String).join(".");

/** Prefix the feature id to messages under `features.N` so errors name the feature. */
function withFeatureId(input: unknown, path: readonly PropertyKey[], message: string): string {
  if (path[0] !== "features" || typeof path[1] !== "number" || message.startsWith("Feature \"")) return message;
  const features = isRecord(input) ? input.features : undefined;
  const feature = Array.isArray(features) ? (features[path[1]] as unknown) : undefined;
  const id = isRecord(feature) && typeof feature.id === "string" ? feature.id : undefined;
  return id === undefined ? `Feature #${path[1]}: ${message}` : `Feature "${id}": ${message}`;
}

/**
 * Validate an already-parsed (and migrated) document. Returns the typed map,
 * or every shape and cross-feature issue with its dotted JSON path.
 */
export function validateMap(input: unknown): ValidationResult {
  const shape = documentShapeSchema.safeParse(input);
  const issues: ValidationIssue[] = [];
  if (!shape.success) {
    for (const issue of shape.error.issues) {
      issues.push({ path: pathToString(issue.path), message: withFeatureId(input, issue.path, issue.message) });
    }
  }
  const features = isRecord(input) ? input.features : undefined;
  for (const issue of checkFeatureRefs(features)) {
    issues.push({ path: pathToString(issue.path), message: issue.message });
  }
  if (issues.length > 0 || !shape.success) return { ok: false, issues };
  return { ok: true, map: shape.data };
}
