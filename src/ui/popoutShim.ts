/**
 * Pop-out window shim for Leaflet (design D6, spec map-view "Pop-out window support").
 *
 * Leaflet binds drag-time listeners (`mousemove`/`mouseup`, touch events,
 * `keydown`, `selectstart`, `dragstart`) to the *global* `document` and
 * `window`. In an Obsidian pop-out window the map lives in another document, so
 * those events never arrive and a drag never moves or never ends.
 *
 * The shim wraps the few Leaflet methods that add or remove such listeners. While
 * a wrapped method runs, `addEventListener` / `removeEventListener` on the main
 * `document` and `window` are temporarily re-pointed to the map's own document
 * and window (instance properties shadowing the prototype, removed in `finally`).
 * The swap is synchronous and decided per call from the instance's own element,
 * so several maps in different windows each route to their own window. When the
 * map is in the main window, the original method runs untouched.
 *
 * Capture-phase listeners (`useCapture === true`) are not re-pointed: Leaflet's
 * one-off global pointer tracker registers that way, and it must stay on the
 * main document.
 *
 * This module takes the Leaflet namespace as a parameter and never imports
 * `leaflet` itself, so it can be unit-tested without a DOM.
 */

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
type ListenerArgs = [type: string, listener: unknown, options?: unknown];
type ListenerMethod = (...args: ListenerArgs) => void;

/** The DOM surface the shim touches: a window with its document. */
export interface ShimWindow {
  document: ShimTarget & { body?: { classList: { add(c: string): void; remove(c: string): void } } | null };
  addEventListener: ListenerMethod;
  removeEventListener: ListenerMethod;
}

export interface ShimTarget {
  addEventListener: ListenerMethod;
  removeEventListener: ListenerMethod;
}

/** The part of the Leaflet namespace the shim patches. */
export interface ShimLeaflet {
  Draggable: { prototype: object };
  Map: { BoxZoom?: { prototype: object }; Keyboard?: { prototype: object }; TouchZoom?: { prototype: object } };
}

/** How to find the window a Leaflet object lives in. */
type OwnerOf = (self: unknown) => ShimWindow | null | undefined;

const PATCHED = Symbol.for("mythical-maps.popoutShim");

/** Window owning `el`, via `el.ownerDocument.defaultView`. */
function windowOf(el: unknown): ShimWindow | null {
  const doc = (el as { ownerDocument?: { defaultView?: unknown } } | null | undefined)?.ownerDocument;
  return (doc?.defaultView as ShimWindow | undefined) ?? null;
}

const draggableOwner: OwnerOf = (self) => windowOf((self as { _element?: unknown })._element);
const handlerOwner: OwnerOf = (self) => windowOf((self as { _map?: { _container?: unknown } })._map?._container);

/** Which methods to wrap, per prototype. Only these add or remove global listeners. */
export const PATCH_TABLE: ReadonlyArray<{ path: string; methods: string[]; owner: OwnerOf }> = [
  { path: "Draggable", methods: ["_onDown", "_onMove", "finishDrag"], owner: draggableOwner },
  { path: "Map.BoxZoom", methods: ["_onMouseDown", "_finish"], owner: handlerOwner },
  { path: "Map.Keyboard", methods: ["_addHooks", "_removeHooks"], owner: handlerOwner },
  { path: "Map.TouchZoom", methods: ["_onTouchStart", "_onTouchEnd"], owner: handlerOwner },
];

/**
 * Re-point `target`'s add/removeEventListener to `dest` (except capture-phase
 * listeners). Returns a function that restores the original state exactly.
 */
function redirect(target: ShimTarget, dest: ShimTarget): () => void {
  const saved = (["addEventListener", "removeEventListener"] as const).map((name) => {
    const own = Object.getOwnPropertyDescriptor(target, name);
    const original = target[name];
    const routed: ListenerMethod = (type, listener, options) => {
      if (options === true) original.call(target, type, listener, options);
      else dest[name](type, listener, options);
    };
    Object.defineProperty(target, name, { value: routed, configurable: true, writable: true });
    return { name, own };
  });
  return () => {
    for (const { name, own } of saved) {
      if (own) Object.defineProperty(target, name, own);
      else delete (target as unknown as Record<string, unknown>)[name];
    }
  };
}

/**
 * Run `fn` with the main window's document and window listeners routed to
 * `owner`. Runs `fn` directly when `owner` is the main window (or unknown).
 */
export function withOwnerWindow<T>(main: ShimWindow, owner: ShimWindow | null | undefined, fn: () => T): T {
  if (!owner || owner === main || owner.document === main.document) return fn();
  const restoreDoc = redirect(main.document, owner.document);
  const restoreWin = redirect(main, owner);
  try {
    return fn();
  } finally {
    restoreWin();
    restoreDoc();
  }
}

function lookup(L: ShimLeaflet, path: string): object | undefined {
  let node: unknown = L;
  for (const key of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[key];
  return (node as { prototype?: object } | undefined)?.prototype;
}

/**
 * Leaflet adds `leaflet-dragging` to the *main* `document.body` during a drag;
 * mirror it onto the owner's body so the drag cursor shows in a pop-out.
 */
function mirrorDraggingClass(main: ShimWindow, self: unknown, method: string): void {
  const owner = draggableOwner(self);
  if (!owner || owner.document === main.document) return;
  const body = owner.document.body;
  if (!body) return;
  if (method === "_onMove" && (self as { _moved?: boolean })._moved) body.classList.add("leaflet-dragging");
  if (method === "finishDrag") body.classList.remove("leaflet-dragging");
}

/**
 * Patch Leaflet's prototypes once (idempotent). Call before creating any map,
 * because Leaflet captures handler references when a map or draggable is enabled.
 * Returns the list of `path.method` names that were patched.
 */
export function installPopoutShim(L: ShimLeaflet, main: ShimWindow = globalThis as unknown as ShimWindow): string[] {
  const patched: string[] = [];
  for (const { path, methods, owner } of PATCH_TABLE) {
    const proto = lookup(L, path) as (Record<string | symbol, unknown> & object) | undefined;
    if (!proto) continue;
    for (const method of methods) {
      const original = proto[method];
      if (typeof original !== "function") continue;
      if ((original as unknown as Record<symbol, unknown>)[PATCHED]) {
        patched.push(`${path}.${method}`);
        continue;
      }
      const wrapped = function (this: unknown, ...args: unknown[]): unknown {
        const result = withOwnerWindow(main, owner(this), () => (original as AnyFn).apply(this, args));
        if (path === "Draggable") mirrorDraggingClass(main, this, method);
        return result;
      };
      Object.defineProperty(wrapped, PATCHED, { value: true });
      proto[method] = wrapped;
      patched.push(`${path}.${method}`);
    }
  }
  return patched;
}
