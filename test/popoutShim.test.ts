import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { installPopoutShim, PATCH_TABLE, withOwnerWindow, type ShimLeaflet, type ShimWindow } from "../src/ui/popoutShim";

/** Event targets record "<name>+type" / "<name>-type" into a shared log. */
class FakeTarget {
  constructor(
    private name: string,
    private log: string[],
  ) {}
  addEventListener(type: string, _listener: unknown, options?: unknown): void {
    this.log.push(`${this.name}+${type}${options === true ? "(capture)" : ""}`);
  }
  removeEventListener(type: string, _listener: unknown, options?: unknown): void {
    this.log.push(`${this.name}-${type}${options === true ? "(capture)" : ""}`);
  }
}

class FakeDocument extends FakeTarget {
  defaultView: FakeWindow | null = null;
  body = { classes: new Set<string>(), classList: { add: (c: string) => this.body.classes.add(c), remove: (c: string) => this.body.classes.delete(c) } };
}

class FakeWindow extends FakeTarget {
  document: FakeDocument;
  constructor(name: string, log: string[]) {
    super(`${name}.win`, log);
    this.document = new FakeDocument(`${name}.doc`, log);
    this.document.defaultView = this;
  }
}

function setup() {
  const log: string[] = [];
  const main = new FakeWindow("main", log);
  const popout = new FakeWindow("pop", log);
  const asShim = (w: FakeWindow) => w as unknown as ShimWindow;
  return { log, main, popout, asShim };
}

/** A Leaflet-like namespace whose methods use the *main* document, like Leaflet's free `document`. */
function fakeLeaflet(main: FakeWindow) {
  const handler = () => {};
  class Draggable {
    _moved = false;
    constructor(public _element: { ownerDocument: FakeDocument }) {}
    _onDown(): string {
      main.addEventListener("dragstart", handler);
      main.document.addEventListener("mousemove", handler, false);
      main.document.addEventListener("mouseup", handler, false);
      // Leaflet's one-off global pointer tracker uses capture and must stay on main.
      main.document.addEventListener("pointerdown", handler, true);
      return "down";
    }
    _onMove(): void {
      this._moved = true;
    }
    finishDrag(): void {
      main.document.removeEventListener("mousemove", handler, false);
      main.document.removeEventListener("mouseup", handler, false);
      main.removeEventListener("dragstart", handler);
    }
  }
  class BoxZoom {
    constructor(public _map: { _container: { ownerDocument: FakeDocument } }) {}
    _onMouseDown(): void {
      main.document.addEventListener("mousemove", handler);
    }
    _finish(): void {
      main.document.removeEventListener("mousemove", handler);
    }
  }
  class Keyboard {
    _addHooks(): void {
      throw new Error("boom");
    }
    _removeHooks(): void {}
  }
  return { Draggable, Map: { BoxZoom, Keyboard } };
}

describe("withOwnerWindow", () => {
  it("routes main document and window listeners to the owner window, then restores", () => {
    const { log, main, popout, asShim } = setup();
    withOwnerWindow(asShim(main), asShim(popout), () => {
      main.document.addEventListener("mousemove", null, false);
      main.addEventListener("selectstart", null);
      main.document.removeEventListener("mousemove", null);
      main.document.addEventListener("pointerdown", null, true);
    });
    expect(log).toEqual(["pop.doc+mousemove", "pop.win+selectstart", "pop.doc-mousemove", "main.doc+pointerdown(capture)"]);
    log.length = 0;
    main.document.addEventListener("mousemove", null);
    main.addEventListener("keydown", null);
    expect(log).toEqual(["main.doc+mousemove", "main.win+keydown"]);
    // No own properties left behind: the prototype methods are back in charge.
    expect(Object.getOwnPropertyNames(main.document)).not.toContain("addEventListener");
    expect(Object.getOwnPropertyNames(main)).not.toContain("removeEventListener");
  });

  it("restores own-property listeners exactly (not just deletes them)", () => {
    const { log, main, popout, asShim } = setup();
    const own = (type: string) => log.push(`own+${type}`);
    (main.document as unknown as { addEventListener: unknown }).addEventListener = own;
    withOwnerWindow(asShim(main), asShim(popout), () => main.document.addEventListener("mouseup", null));
    main.document.addEventListener("mouseup", null);
    expect(log).toEqual(["pop.doc+mouseup", "own+mouseup"]);
    expect(main.document.addEventListener).toBe(own);
  });

  it("runs directly when the owner is the main window or unknown", () => {
    const { log, main, asShim } = setup();
    expect(withOwnerWindow(asShim(main), asShim(main), () => 1)).toBe(1);
    withOwnerWindow(asShim(main), null, () => main.document.addEventListener("mousemove", null));
    expect(log).toEqual(["main.doc+mousemove"]);
  });

  it("restores even when the wrapped function throws", () => {
    const { log, main, popout, asShim } = setup();
    expect(() =>
      withOwnerWindow(asShim(main), asShim(popout), () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    main.document.addEventListener("mousemove", null);
    expect(log).toEqual(["main.doc+mousemove"]);
  });
});

describe("installPopoutShim", () => {
  it("patches the listed methods once and is idempotent", () => {
    const { main, asShim } = setup();
    const L = fakeLeaflet(main);
    const first = installPopoutShim(L as unknown as ShimLeaflet, asShim(main));
    const patchedDown = L.Draggable.prototype._onDown;
    const second = installPopoutShim(L as unknown as ShimLeaflet, asShim(main));
    expect(first).toEqual([
      "Draggable._onDown",
      "Draggable._onMove",
      "Draggable.finishDrag",
      "Map.BoxZoom._onMouseDown",
      "Map.BoxZoom._finish",
      "Map.Keyboard._addHooks",
      "Map.Keyboard._removeHooks",
    ]);
    expect(second).toEqual(first);
    expect(L.Draggable.prototype._onDown).toBe(patchedDown);
  });

  it("a drag in a pop-out listens on the pop-out document and ends there", () => {
    const { log, main, popout, asShim } = setup();
    const L = fakeLeaflet(main);
    installPopoutShim(L as unknown as ShimLeaflet, asShim(main));
    const d = new L.Draggable({ ownerDocument: popout.document });
    expect(d._onDown()).toBe("down");
    expect(log).toEqual(["pop.win+dragstart", "pop.doc+mousemove", "pop.doc+mouseup", "main.doc+pointerdown(capture)"]);
    d._onMove();
    expect(popout.document.body.classes.has("leaflet-dragging")).toBe(true);
    log.length = 0;
    d.finishDrag();
    expect(log).toEqual(["pop.doc-mousemove", "pop.doc-mouseup", "pop.win-dragstart"]);
    expect(popout.document.body.classes.has("leaflet-dragging")).toBe(false);
  });

  it("a drag in the main window is untouched", () => {
    const { log, main, asShim } = setup();
    const L = fakeLeaflet(main);
    installPopoutShim(L as unknown as ShimLeaflet, asShim(main));
    const d = new L.Draggable({ ownerDocument: main.document });
    d._onDown();
    d._onMove();
    d.finishDrag();
    expect(log.every((e) => e.startsWith("main."))).toBe(true);
  });

  it("maps in different windows each route to their own window", () => {
    const log: string[] = [];
    const main = new FakeWindow("main", log);
    const popA = new FakeWindow("a", log);
    const popB = new FakeWindow("b", log);
    const L = fakeLeaflet(main);
    installPopoutShim(L as unknown as ShimLeaflet, main as unknown as ShimWindow);
    new L.Map.BoxZoom({ _container: { ownerDocument: popA.document } })._onMouseDown();
    new L.Map.BoxZoom({ _container: { ownerDocument: popB.document } })._onMouseDown();
    new L.Map.BoxZoom({ _container: { ownerDocument: main.document } })._onMouseDown();
    expect(log).toEqual(["a.doc+mousemove", "b.doc+mousemove", "main.doc+mousemove"]);
  });

  it("propagates errors from the original method and leaves the main document intact", () => {
    const { log, main, popout, asShim } = setup();
    const L = fakeLeaflet(main);
    installPopoutShim(L as unknown as ShimLeaflet, asShim(main));
    const kb = new L.Map.Keyboard() as unknown as { _map: unknown; _addHooks(): void };
    kb._map = { _container: { ownerDocument: popout.document } };
    expect(() => kb._addHooks()).toThrow("boom");
    main.document.addEventListener("keydown", null);
    expect(log).toEqual(["main.doc+keydown"]);
  });

  it("skips prototypes or methods that do not exist", () => {
    const { main, asShim } = setup();
    expect(installPopoutShim({ Draggable: { prototype: {} }, Map: {} }, asShim(main))).toEqual([]);
  });
});

describe("Leaflet 1.9 still has the methods the shim patches", () => {
  // Leaflet can't be imported in node (it needs `window`), so check its source instead.
  const src = readFileSync(fileURLToPath(new URL("../node_modules/leaflet/dist/leaflet-src.js", import.meta.url)), "utf8");
  for (const { path, methods } of PATCH_TABLE) {
    for (const method of methods) {
      it(`${path}.${method}`, () => {
        expect(src).toContain(`\t${method}: function (`);
      });
    }
  }

  it("Draggable binds its move/up listeners to the global document", () => {
    expect(src).toContain("on(document, mouseevent ? 'mousemove' : 'touchmove', this._onMove, this);");
  });
});
