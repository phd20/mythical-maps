/**
 * Feature tree operations (design D1/D10, specs map-editing "Folder tree
 * management" / "Delete features" and map-view "Visibility rules").
 *
 * Pure and immutable: no function mutates its inputs; mutating operations
 * return a new `MapDocument` that shares untouched features with the input.
 * Geometry is not validated here (that is the schema's job).
 */
import { newId, rankAfter, rankBetween } from "./ids";
import type { Feature, MapDocument } from "./schema";

export type OpResult = { ok: true; map: MapDocument } | { ok: false; error: string };
export type InsertResult = { ok: true; map: MapDocument; id: string } | { ok: false; error: string };
export type DeleteResult = { ok: true; map: MapDocument; removed: Feature[] } | { ok: false; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A feature to insert: `id` is optional (generated when missing or taken), `rank` is ignored. */
export type NewFeature = DistributiveOmit<Feature, "id" | "rank"> & { id?: string; rank?: string };

/** Shallow patch of a feature's own fields; `undefined` removes a key, `style` merges one level deep. */
export type FeaturePatch = { [key: string]: unknown; style?: Record<string, unknown> | undefined };

export interface Placement {
  /** Parent folder id, or null for the root. */
  parentId?: string | null;
  /** Place directly before this sibling. */
  before?: string;
  /** Place directly after this sibling. */
  after?: string;
}

const byRankThenId = (a: Feature, b: Feature): number =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const findFeature = (map: MapDocument, id: string): Feature | undefined => map.features.find((f) => f.id === id);

/** The feature with `id`, or undefined. */
export function getFeature(map: MapDocument, id: string): Feature | undefined {
  return findFeature(map, id);
}

/** Direct children of `parentId` (null = root), sorted by rank then id. */
export function children(map: MapDocument, parentId: string | null): Feature[] {
  return map.features.filter((f) => (f.parentId ?? null) === parentId).sort(byRankThenId);
}

/** All descendants of `id` in depth-first tree order (excluding `id` itself). */
export function descendants(map: MapDocument, id: string): Feature[] {
  const byParent = new Map<string, Feature[]>();
  for (const f of map.features) {
    if (f.parentId === undefined) continue;
    const list = byParent.get(f.parentId);
    if (list) list.push(f);
    else byParent.set(f.parentId, [f]);
  }
  const out: Feature[] = [];
  const seen = new Set<string>([id]);
  const walk = (parent: string): void => {
    for (const child of (byParent.get(parent) ?? []).sort(byRankThenId)) {
      if (seen.has(child.id)) continue; // cycle guard for malformed input
      seen.add(child.id);
      out.push(child);
      walk(child.id);
    }
  };
  walk(id);
  return out;
}

/** Ancestor folders of `id`, nearest first. Empty for root features or unknown ids. */
export function ancestors(map: MapDocument, id: string): Feature[] {
  const out: Feature[] = [];
  const seen = new Set<string>([id]);
  let cur = findFeature(map, id)?.parentId;
  while (cur !== undefined && !seen.has(cur)) {
    seen.add(cur);
    const parent = findFeature(map, cur);
    if (!parent) break;
    out.push(parent);
    cur = parent.parentId;
  }
  return out;
}

/** True when the feature or any ancestor folder has `isHidden: true`. */
export function effectiveHidden(map: MapDocument, id: string): boolean {
  const feature = findFeature(map, id);
  if (!feature) return false;
  return feature.isHidden === true || ancestors(map, id).some((a) => a.isHidden === true);
}

const ZOOM_EPSILON = 1e-9;

/**
 * Whether `zoom` lies inside the feature's `visibilityRange` `[a, b]` mapped
 * linearly onto `[minZoom, maxZoom]` (inclusive). No range means always visible.
 */
export function visibleAtZoom(
  feature: Pick<Feature, "visibilityRange">,
  zoom: number,
  minZoom: number,
  maxZoom: number,
): boolean {
  const range = feature.visibilityRange;
  if (!range) return true;
  const span = maxZoom - minZoom;
  const lo = minZoom + range[0] * span;
  const hi = minZoom + range[1] * span;
  return zoom >= lo - ZOOM_EPSILON && zoom <= hi + ZOOM_EPSILON;
}

/** Not effectively hidden and inside its zoom range. False for unknown ids. */
export function isVisible(map: MapDocument, id: string, zoom: number, minZoom: number, maxZoom: number): boolean {
  const feature = findFeature(map, id);
  if (!feature) return false;
  return !effectiveHidden(map, id) && visibleAtZoom(feature, zoom, minZoom, maxZoom);
}

/** Validate the target parent: null/undefined (root) or an existing folder. */
function checkParent(map: MapDocument, parentId: string | null | undefined): string | null {
  if (parentId === null || parentId === undefined) return null;
  const parent = findFeature(map, parentId);
  if (!parent) return `parent "${parentId}" does not exist`;
  if (parent.type !== "folder") return `parent "${parentId}" is a ${parent.type}, not a folder`;
  return null;
}

/** Compute a rank among `siblings` (sorted, not containing the placed feature). */
function rankFor(siblings: Feature[], placement: Placement): { ok: true; rank: string } | { ok: false; error: string } {
  if (placement.before !== undefined && placement.after !== undefined) {
    return { ok: false, error: "give at most one of before / after" };
  }
  const ref = placement.before ?? placement.after;
  let lower: string | null;
  let upper: string | null;
  if (ref === undefined) {
    lower = siblings.at(-1)?.rank ?? null;
    upper = null;
  } else {
    const index = siblings.findIndex((s) => s.id === ref);
    if (index < 0) return { ok: false, error: `"${ref}" is not a sibling in the target folder` };
    const at = placement.before !== undefined ? index : index + 1;
    lower = siblings[at - 1]?.rank ?? null;
    upper = siblings[at]?.rank ?? null;
  }
  try {
    if (lower !== null && upper !== null && lower >= upper) {
      // Siblings share a rank (e.g. hand-edited file); fall back to just after `lower`.
      return { ok: true, rank: rankAfter(lower) };
    }
    return { ok: true, rank: upper === null ? rankAfter(lower) : rankBetween(lower, upper) };
  } catch (e) {
    return { ok: false, error: `cannot compute rank: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function withParent(feature: Feature, parentId: string | null, rank: string): Feature {
  const next = { ...feature, rank } as Feature;
  if (parentId === null) delete next.parentId;
  else next.parentId = parentId;
  return next;
}

/**
 * Insert a feature under `parentId` (default root), last among siblings or
 * next to `before` / `after`. The rank is always assigned here; the id is
 * kept unless it is missing or already taken.
 */
export function insert(map: MapDocument, feature: NewFeature, placement: Placement = {}): InsertResult {
  const parentId = placement.parentId ?? null;
  const parentError = checkParent(map, parentId);
  if (parentError) return { ok: false, error: parentError };
  const rank = rankFor(children(map, parentId), placement);
  if (!rank.ok) return rank;
  const taken = new Set(map.features.map((f) => f.id));
  const id = feature.id !== undefined && feature.id !== "" && !taken.has(feature.id) ? feature.id : newId(taken);
  const created = withParent({ ...feature, id, rank: rank.rank } as Feature, parentId, rank.rank);
  return { ok: true, map: { ...map, features: [...map.features, created] }, id };
}

/**
 * Move a feature to `parentId` (null = root), last among its new siblings or
 * next to `before` / `after`. Refuses moving into itself, a descendant or a
 * non-folder. Only the moved feature changes.
 */
export function move(map: MapDocument, id: string, placement: Placement & { parentId: string | null }): OpResult {
  const feature = findFeature(map, id);
  if (!feature) return { ok: false, error: `feature "${id}" does not exist` };
  const parentId = placement.parentId;
  if (placement.before === id || placement.after === id) {
    return { ok: false, error: "cannot place a feature relative to itself" };
  }
  if (parentId !== null) {
    if (parentId === id) return { ok: false, error: "cannot move a feature into itself" };
    if (descendants(map, id).some((d) => d.id === parentId)) {
      return { ok: false, error: "cannot move a folder into one of its descendants" };
    }
  }
  const parentError = checkParent(map, parentId);
  if (parentError) return { ok: false, error: parentError };
  const siblings = children(map, parentId).filter((f) => f.id !== id);
  const rank = rankFor(siblings, placement);
  if (!rank.ok) return rank;
  const moved = withParent(feature, parentId, rank.rank);
  return { ok: true, map: { ...map, features: map.features.map((f) => (f.id === id ? moved : f)) } };
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Shallow-merge `patch` into the feature (`style` merged one level deep).
 * A value of `undefined` removes the key. Refuses changing `id`, `type` or
 * `parentId` (use `move` to reparent).
 */
export function update(map: MapDocument, id: string, patch: FeaturePatch): OpResult {
  const feature = findFeature(map, id);
  if (!feature) return { ok: false, error: `feature "${id}" does not exist` };
  for (const key of ["id", "type", "parentId"] as const) {
    if (key in patch && patch[key] !== feature[key]) {
      return { ok: false, error: key === "parentId" ? "use move to change parentId" : `cannot change ${key}` };
    }
  }
  const merged: Record<string, unknown> = { ...feature, ...patch };
  if ("style" in patch && patch.style !== undefined) {
    merged.style = stripUndefined({ ...(feature.style ?? {}), ...patch.style });
  }
  const next = stripUndefined(merged) as Feature;
  return { ok: true, map: { ...map, features: map.features.map((f) => (f.id === id ? next : f)) } };
}

/** Remove a feature and all its descendants. `removed` is in document order, for `restore`. */
export function deleteSubtree(map: MapDocument, id: string): DeleteResult {
  if (!findFeature(map, id)) return { ok: false, error: `feature "${id}" does not exist` };
  const ids = new Set<string>([id, ...descendants(map, id).map((d) => d.id)]);
  const removed = map.features.filter((f) => ids.has(f.id));
  return { ok: true, map: { ...map, features: map.features.filter((f) => !ids.has(f.id)) }, removed };
}

/**
 * Undo `deleteSubtree`: re-add `removed` features unchanged. Refuses if an id
 * is already present or a parent is neither in the map nor in `removed`.
 */
export function restore(map: MapDocument, removed: readonly Feature[]): OpResult {
  const present = new Map<string, Feature>(map.features.map((f) => [f.id, f]));
  const incoming = new Map<string, Feature>();
  for (const f of removed) {
    if (present.has(f.id) || incoming.has(f.id)) return { ok: false, error: `feature "${f.id}" already exists` };
    incoming.set(f.id, f);
  }
  for (const f of removed) {
    if (f.parentId === undefined) continue;
    const parent = present.get(f.parentId) ?? incoming.get(f.parentId);
    if (!parent) return { ok: false, error: `parent "${f.parentId}" of "${f.id}" does not exist` };
    if (parent.type !== "folder") return { ok: false, error: `parent "${f.parentId}" of "${f.id}" is not a folder` };
  }
  return { ok: true, map: { ...map, features: [...map.features, ...removed] } };
}
