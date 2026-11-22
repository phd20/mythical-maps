/**
 * Creating pins and labels (spec map-editing "Create features", bead 5.2).
 *
 * Pure helpers that turn a click position into an `insert` op: where the new
 * feature goes (the selected folder, or the root) and what it looks like by
 * default. The insert itself places it as the last sibling (`features.insert`).
 */
import type { Op } from "./document";
import { getFeature } from "./features";
import type { LatLng, MapDocument } from "./schema";

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
