/**
 * Pure view-model of the feature panel tree (spec map-editing "Folder tree
 * management"): the visible rows in rank order, and drag-and-drop planning.
 * No DOM; the panel in `ui/featurePanel.ts` renders what this computes.
 */
import { children, descendants, getFeature, hiddenIds, move } from "./features";
import type { Placement } from "./features";
import type { Feature, MapDocument } from "./schema";

export interface TreeRow {
  feature: Feature;
  depth: number;
  /** A folder with at least one child. */
  hasChildren: boolean;
  /** A folder whose children are folded away. */
  collapsed: boolean;
  /** The feature or an ancestor folder is hidden. */
  effectivelyHidden: boolean;
}

/** Where, relative to the row it is dropped on, a dragged feature lands. */
export type DropZone = "before" | "after" | "inside";

/**
 * Visible rows, depth first, siblings by rank. Children of a collapsed folder
 * are left out. Features whose parent is missing or not a folder (malformed
 * input the schema would reject) are shown at the root, and cycles are cut.
 */
export function treeRows(map: MapDocument, collapsed: ReadonlySet<string> = new Set()): TreeRow[] {
  const hidden = hiddenIds(map);
  const rows: TreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number): void => {
    for (const feature of children(map, parentId)) {
      if (seen.has(feature.id)) continue;
      seen.add(feature.id);
      const kids = feature.type === "folder" ? children(map, feature.id) : [];
      const isCollapsed = kids.length > 0 && collapsed.has(feature.id);
      rows.push({
        feature,
        depth,
        hasChildren: kids.length > 0,
        collapsed: isCollapsed,
        effectivelyHidden: hidden.has(feature.id),
      });
      if (feature.type === "folder" && !isCollapsed) walk(feature.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans: parent missing or not a folder.
  for (const feature of map.features) {
    if (seen.has(feature.id) || feature.parentId === undefined) continue;
    if (getFeature(map, feature.parentId)?.type === "folder") continue;
    seen.add(feature.id);
    rows.push({ feature, depth: 0, hasChildren: false, collapsed: false, effectivelyHidden: hidden.has(feature.id) });
  }
  return rows;
}

/** The drop zone for a pointer at `ratio` (0 = top edge, 1 = bottom edge) of a row. */
export function dropZoneFor(ratio: number, targetIsFolder: boolean): DropZone {
  if (targetIsFolder) {
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "inside";
  }
  return ratio < 0.5 ? "before" : "after";
}

export type DropPlan =
  | { ok: true; id: string; placement: Placement & { parentId: string | null } }
  | { ok: false; error: string };

/**
 * Plan dropping `dragId` onto `targetId` in `zone`. "inside" makes the target
 * folder the new parent (last child); "before"/"after" put it next to the
 * target under the target's parent. Refuses (changing nothing) a drop onto
 * itself, into a non-folder, or a folder into itself or its own descendants.
 */
export function planDrop(map: MapDocument, dragId: string, targetId: string, zone: DropZone): DropPlan {
  const dragged = getFeature(map, dragId);
  const target = getFeature(map, targetId);
  if (!dragged) return { ok: false, error: `feature "${dragId}" does not exist` };
  if (!target) return { ok: false, error: `feature "${targetId}" does not exist` };
  if (dragId === targetId) return { ok: false, error: "cannot drop a feature onto itself" };
  if (zone === "inside" && target.type !== "folder") return { ok: false, error: "only folders can hold features" };
  if (dragged.type === "folder" && descendants(map, dragId).some((d) => d.id === targetId)) {
    return { ok: false, error: "cannot move a folder into one of its descendants" };
  }
  const placement: Placement & { parentId: string | null } =
    zone === "inside"
      ? { parentId: target.id }
      : zone === "before"
        ? { parentId: target.parentId ?? null, before: target.id }
        : { parentId: target.parentId ?? null, after: target.id };
  // Dry run so every refusal reason of `move` (cycles, rank failures) surfaces here.
  const result = move(map, dragId, placement);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, id: dragId, placement };
}

/**
 * The parent a new folder goes into: the selected feature when it is a
 * folder, else the root (spec "New features go into the currently selected
 * folder, or the root when none is selected").
 */
export function newFolderParent(map: MapDocument, selectedId: string | null): string | null {
  if (selectedId === null) return null;
  return getFeature(map, selectedId)?.type === "folder" ? selectedId : null;
}
