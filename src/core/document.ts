/**
 * Map document store (design D1/D10, specs map-editing "Lock toggle",
 * "Undo within a session" and "Saving").
 *
 * Holds the current immutable `MapDocument`, applies edit ops through the
 * pure functions in `features.ts`, and keeps undo/redo history as whole-map
 * snapshots (cheap because maps are immutable and share untouched features).
 * The lock is enforced here, at the model layer: while locked every edit op,
 * undo and redo are refused; only `replace` (external reload) still works.
 */
import { deleteSubtree, insert, move, update } from "./features";
import type { FeaturePatch, NewFeature, OpResult, Placement } from "./features";
import type { MapDocument, MapImage, Viewport } from "./schema";

export type Op =
  | { type: "insert"; feature: NewFeature; placement?: Placement }
  | { type: "move"; id: string; placement: Placement & { parentId: string | null } }
  | { type: "update"; id: string; patch: FeaturePatch }
  | { type: "delete"; id: string }
  | { type: "setViewport"; viewport: Viewport | undefined }
  | { type: "setImage"; image: MapImage }
  | { type: "replace"; map: MapDocument };

export type ApplyResult = OpResult & { id?: string };

export type ChangeKind = "apply" | "undo" | "redo" | "replace";

export interface Change {
  op?: Op;
  kind: ChangeKind;
}

export type Listener = (map: MapDocument, change: Change) => void;

/** Maximum number of undo (and redo) entries kept. */
export const HISTORY_LIMIT = 200;

export const LOCKED_ERROR = "Map is locked";

function run(map: MapDocument, op: Exclude<Op, { type: "replace" }>): ApplyResult {
  switch (op.type) {
    case "insert":
      return insert(map, op.feature, op.placement);
    case "move":
      return move(map, op.id, op.placement);
    case "update":
      return update(map, op.id, op.patch);
    case "delete": {
      const result = deleteSubtree(map, op.id);
      return result.ok ? { ok: true, map: result.map } : result;
    }
    case "setViewport": {
      const next: MapDocument = { ...map };
      if (op.viewport === undefined) delete next.viewport;
      else next.viewport = op.viewport;
      return { ok: true, map: next };
    }
    case "setImage":
      return { ok: true, map: { ...map, image: op.image } };
  }
}

export class MapStore {
  private current: MapDocument;
  private undoStack: MapDocument[] = [];
  private redoStack: MapDocument[] = [];
  private listeners = new Set<Listener>();
  private locked = false;
  private isDirty = false;

  constructor(map: MapDocument) {
    this.current = map;
  }

  get map(): MapDocument {
    return this.current;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get canUndo(): boolean {
    return !this.locked && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return !this.locked && this.redoStack.length > 0;
  }

  /** True after any apply/undo/redo since construction or the last `markSaved()`. */
  get dirty(): boolean {
    return this.isDirty;
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  markSaved(): void {
    this.isDirty = false;
  }

  /** Register a listener for successful state changes; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply an op. Errors from `features.ts` are returned unchanged and leave
   * the store untouched. `replace` swaps in a map loaded from disk: it works
   * while locked, clears both history stacks and does not mark the store dirty.
   */
  apply(op: Op): ApplyResult {
    if (op.type === "replace") {
      this.current = op.map;
      this.undoStack = [];
      this.redoStack = [];
      this.emit({ op, kind: "replace" });
      return { ok: true, map: op.map };
    }
    if (this.locked) return { ok: false, error: LOCKED_ERROR };
    const result = run(this.current, op);
    if (!result.ok) return result;
    this.pushUndo(this.current);
    this.redoStack = [];
    this.current = result.map;
    this.isDirty = true;
    this.emit({ op, kind: "apply" });
    return result;
  }

  /** Revert the last applied op. Returns false when locked or nothing to undo. */
  undo(): boolean {
    if (this.locked) return false;
    const previous = this.undoStack.pop();
    if (previous === undefined) return false;
    this.redoStack.push(this.current);
    this.current = previous;
    this.isDirty = true;
    this.emit({ kind: "undo" });
    return true;
  }

  /** Re-apply the last undone op. Returns false when locked or nothing to redo. */
  redo(): boolean {
    if (this.locked) return false;
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.pushUndo(this.current);
    this.current = next;
    this.isDirty = true;
    this.emit({ kind: "redo" });
    return true;
  }

  private pushUndo(map: MapDocument): void {
    this.undoStack.push(map);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.splice(0, this.undoStack.length - HISTORY_LIMIT);
  }

  private emit(change: Change): void {
    for (const listener of [...this.listeners]) listener(this.current, change);
  }
}
