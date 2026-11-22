/**
 * Creating pins and labels (spec map-editing "Create features", bead 5.2).
 *
 * Pure helpers that turn a click position into an `insert` op: where the new
 * feature goes (the selected folder, or the root) and what it looks like by
 * default. The insert itself places it as the last sibling (`features.insert`).
 */
import type { Op } from "./document";
import { getFeature } from "./features";
import type { FeaturePatch } from "./features";
import type { Feature, LatLng, MapDocument } from "./schema";

export type CreatableKind = "pin" | "label";

export const DEFAULT_NAMES: Record<CreatableKind, string> = { pin: "New pin", label: "New label" };

/**
 * Where a new feature goes: the selected folder's id, or `null` (root) when
 * nothing is selected or the id is unknown. A selected non-folder feature
 * stands for its own folder, so the new feature lands next to it.
 */
export function creationParent(map: MapDocument, selectedId: string | null): string | null {
  if (selectedId === null) return null;
  const selected = getFeature(map, selectedId);
  if (!selected) return null;
  if (selected.type === "folder") return selected.id;
  return selected.parentId ?? null;
}

/** The `insert` op for a new pin or label at `pos`: new id, default style (none stored), last child of the target folder. */
export function createFeatureOp(
  map: MapDocument,
  kind: CreatableKind,
  pos: LatLng,
  selectedId: string | null,
): Extract<Op, { type: "insert" }> {
  return {
    type: "insert",
    feature: { type: kind, name: DEFAULT_NAMES[kind], pos: [pos[0], pos[1]] },
    placement: { parentId: creationParent(map, selectedId) },
  };
}

/** Minimum vertices: a region needs 3, a path 2 (the schema's limits). */
export const MIN_VERTICES = { region: 3, path: 2 } as const;
export type DrawableKind = keyof typeof MIN_VERTICES;

export const DEFAULT_SHAPE_NAMES: Record<DrawableKind, string> = { region: "New region", path: "New path" };

/** A point as Leaflet reports it (`L.LatLng`), without importing Leaflet. */
export interface LatLngLike {
  lat: number;
  lng: number;
}

/** Drop consecutive duplicate points (a double-click can place the last vertex twice). */
function dedupe(points: LatLngLike[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p.lat || last[1] !== p.lng) out.push([p.lat, p.lng]);
  }
  return out;
}

/** A ring Leaflet may report closed (first point repeated at the end); the model stores it open. */
function openRing(points: LatLngLike[]): LatLng[] {
  const ring = dedupe(points);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && first[0] === last[0] && first[1] === last[1]) ring.pop();
  return ring;
}

/**
 * The `insert` op for a drawn region or path, or `null` when there are too few
 * distinct vertices (region < 3, path < 2): nothing is created then.
 */
export function createShapeOp(
  map: MapDocument,
  kind: DrawableKind,
  vertices: LatLngLike[],
  selectedId: string | null,
): Extract<Op, { type: "insert" }> | null {
  const placement = { parentId: creationParent(map, selectedId) };
  if (kind === "region") {
    const polygon = openRing(vertices);
    if (polygon.length < MIN_VERTICES.region) return null;
    return { type: "insert", feature: { type: "region", name: DEFAULT_SHAPE_NAMES.region, polygon }, placement };
  }
  const polyline = dedupe(vertices);
  if (polyline.length < MIN_VERTICES.path) return null;
  return { type: "insert", feature: { type: "path", name: DEFAULT_SHAPE_NAMES.path, polyline }, placement };
}

/**
 * The patch that saves a reshaped region or path from the final geometry of an
 * edit gesture, or `null` when the geometry is not valid (too few vertices) or
 * the feature is not a region or path. `latlngs` has Leaflet's shape: for a
 * region with `polygon`, `[ring]`; with `polygons`, `[[ring], ...]`; for a path,
 * the point list. The field the feature already uses is the one patched.
 */
export function geometryPatch(feature: Feature, latlngs: unknown): FeaturePatch | null {
  if (feature.type === "path") {
    const polyline = dedupe(latlngs as LatLngLike[]);
    return polyline.length >= MIN_VERTICES.path ? { polyline } : null;
  }
  if (feature.type !== "region") return null;
  if (feature.polygons) {
    const polygons: LatLng[][] = [];
    for (const part of latlngs as LatLngLike[][][]) {
      const ring = openRing(part[0] ?? []);
      if (ring.length < MIN_VERTICES.region) return null;
      polygons.push(ring);
    }
    return polygons.length > 0 ? { polygons } : null;
  }
  const ring = openRing((latlngs as LatLngLike[][])[0] ?? []);
  return ring.length >= MIN_VERTICES.region ? { polygon: ring } : null;
}
