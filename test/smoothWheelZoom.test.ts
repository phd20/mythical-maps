import { describe, expect, it } from "vitest";
import {
  attachSmoothWheelZoom,
  EASE_TAU_MS,
  EPSILON,
  LINE_PX,
  MAX_EVENT_ZOOM,
  normaliseWheelDelta,
  PINCH_ZOOM_PER_PX,
  PIXEL_ZOOM_PER_PX,
  stepToward,
} from "../src/ui/smoothWheelZoom";

describe("normaliseWheelDelta", () => {
  it("zooms in for wheel up (negative deltaY) in proportion to pixel deltas", () => {
    expect(normaliseWheelDelta({ deltaY: -30, deltaMode: 0, ctrlKey: false })).toBeCloseTo(30 * PIXEL_ZOOM_PER_PX, 10);
    expect(normaliseWheelDelta({ deltaY: 60, deltaMode: 0, ctrlKey: false })).toBeCloseTo(-60 * PIXEL_ZOOM_PER_PX, 10);
  });

  it("uses the larger pinch factor for ctrl-wheel", () => {
    const pinch = normaliseWheelDelta({ deltaY: -10, deltaMode: 0, ctrlKey: true });
    expect(pinch).toBeCloseTo(10 * PINCH_ZOOM_PER_PX, 10);
    expect(pinch).toBeGreaterThan(normaliseWheelDelta({ deltaY: -10, deltaMode: 0, ctrlKey: false }));
  });

  it("normalises line and page deltas to pixels", () => {
    expect(normaliseWheelDelta({ deltaY: -1, deltaMode: 1, ctrlKey: false })).toBeCloseTo(
      normaliseWheelDelta({ deltaY: -LINE_PX, deltaMode: 0, ctrlKey: false }),
      10,
    );
    // One mouse notch (3 lines in Firefox, ~100px in Chrome) is a fraction of a level.
    const notch = normaliseWheelDelta({ deltaY: 3, deltaMode: 1, ctrlKey: false });
    expect(notch).toBeLessThan(0);
    expect(Math.abs(notch)).toBeLessThanOrEqual(MAX_EVENT_ZOOM);
    expect(Math.abs(normaliseWheelDelta({ deltaY: 100, deltaMode: 0, ctrlKey: false }))).toBeLessThan(0.5);
  });

  it("caps a single huge event and ignores zero or non-finite deltas", () => {
    expect(normaliseWheelDelta({ deltaY: -1, deltaMode: 2, ctrlKey: false })).toBe(MAX_EVENT_ZOOM);
    expect(normaliseWheelDelta({ deltaY: 10_000, deltaMode: 0, ctrlKey: true })).toBe(-MAX_EVENT_ZOOM);
    expect(Object.is(normaliseWheelDelta({ deltaY: 0, deltaMode: 0, ctrlKey: false }), 0)).toBe(true);
    expect(normaliseWheelDelta({ deltaY: Number.NaN, deltaMode: 0, ctrlKey: false })).toBe(0);
  });
});

describe("stepToward", () => {
  it("covers 1 - e^-1 of the distance in one time constant", () => {
    expect(stepToward(2, 3, EASE_TAU_MS)).toBeCloseTo(2 + (1 - Math.exp(-1)), 10);
  });

  it("never overshoots, in either direction", () => {
    expect(stepToward(2, 3, 10_000)).toBe(3);
    const down = stepToward(5, 4, 16);
    expect(down).toBeLessThan(5);
    expect(down).toBeGreaterThan(4);
  });

  it("snaps to the target within epsilon and does nothing for dt 0", () => {
    expect(stepToward(3 - EPSILON / 2, 3, 1)).toBe(3);
    expect(stepToward(2, 3, 0)).toBe(2);
    expect(stepToward(2, 3, -5)).toBe(2);
  });
});

// --- The DOM-facing handler, with a fake map, container and window. ---

function setup(opts: { zoom?: number; min?: number; max?: number } = {}) {
  const frames = new Map<number, (t: number) => void>();
  let nextId = 1;
  const cancelled: number[] = [];
  const win = {
    requestAnimationFrame(cb: (t: number) => void): number {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      cancelled.push(id);
      frames.delete(id);
    },
  };
  const listeners = new Map<string, { fn: (e: unknown) => void; options: unknown }>();
  const container = {
    ownerDocument: { defaultView: win },
    addEventListener(type: string, fn: (e: unknown) => void, options: unknown) {
      listeners.set(type, { fn, options });
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
  };
  const calls: { zoom: number; options: unknown }[] = [];
  // CRS.Simple: one map unit is 2^zoom pixels, with latitude pointing up.
  const size = { x: 801, y: 601 };
  const map = {
    center: { lat: -96, lng: 128 },
    getCenter() {
      return { ...this.center };
    },
    getSize() {
      return size;
    },
    project(c: { lat: number; lng: number }, zoom: number) {
      return { x: c.lng * 2 ** zoom, y: -c.lat * 2 ** zoom };
    },
    unproject([x, y]: [number, number], zoom: number) {
      return { lat: -y / 2 ** zoom, lng: x / 2 ** zoom };
    },
    /** Container pixel of a map position in the current view. */
    pixelOf(c: { lat: number; lng: number }) {
      const p = this.project(c, this.zoom);
      const mid = this.project(this.center, this.zoom);
      return { x: p.x - mid.x + size.x / 2, y: p.y - mid.y + size.y / 2 };
    },
    /** Map position under a container pixel in the current view. */
    at(x: number, y: number) {
      const mid = this.project(this.center, this.zoom);
      return this.unproject([mid.x + x - size.x / 2, mid.y + y - size.y / 2], this.zoom);
    },
    zoom: opts.zoom ?? 3,
    min: opts.min ?? 1,
    max: opts.max ?? 6,
    getZoom() {
      return this.zoom;
    },
    getMinZoom() {
      return this.min;
    },
    getMaxZoom() {
      return this.max;
    },
    mouseEventToContainerPoint(e: MouseEvent) {
      return { x: e.clientX, y: e.clientY };
    },
    setView(center: { lat: number; lng: number }, zoom: number, options: unknown) {
      calls.push({ zoom, options });
      this.center = center;
      this.zoom = Math.min(this.max, Math.max(this.min, zoom));
    },
  };
  const handle = attachSmoothWheelZoom(map, container as unknown as HTMLElement);
  let time = 0;
  let prevented = 0;
  const wheel = (deltaY: number, extra: { ctrlKey?: boolean; deltaMode?: number; clientX?: number; clientY?: number } = {}) =>
    listeners.get("wheel")?.fn({
      deltaY,
      deltaMode: extra.deltaMode ?? 0,
      ctrlKey: extra.ctrlKey ?? false,
      clientX: extra.clientX ?? 100,
      clientY: extra.clientY ?? 50,
      preventDefault: () => prevented++,
    });
  /** Run one pending frame, 16 ms after the last. Returns false when none is pending. */
  const frame = (): boolean => {
    const entry = frames.entries().next();
    if (entry.done) return false;
    const [id, cb] = entry.value;
    frames.delete(id);
    time += 16;
    cb(time);
    return true;
  };
  const runAll = (limit = 1000): number => {
    let n = 0;
    while (n < limit && frame()) n++;
    return n;
  };
  return { map, calls, handle, listeners, wheel, frame, runAll, frames, cancelled, prevented: () => prevented };
}

describe("attachSmoothWheelZoom", () => {
  it("listens for non-passive wheel events and prevents the page scroll", () => {
    const t = setup();
    expect(t.listeners.get("wheel")?.options).toEqual({ passive: false });
    t.wheel(-30);
    expect(t.prevented()).toBe(1);
  });

  it("eases toward the target over several frames with one rAF loop, anchored on the pointer", () => {
    const t = setup({ zoom: 3 });
    const under = t.map.at(120, 80);
    t.wheel(-60, { clientX: 120, clientY: 80 });
    t.wheel(-60, { clientX: 120, clientY: 80 });
    // Two events, still one pending frame.
    expect(t.frames.size).toBe(1);
    const target = 3 + 120 * PIXEL_ZOOM_PER_PX;
    t.frame();
    expect(t.map.zoom).toBeGreaterThan(3);
    expect(t.map.zoom).toBeLessThan(target);
    const n = t.runAll();
    expect(n).toBeGreaterThan(3);
    expect(t.map.zoom).toBeCloseTo(target, 2);
    expect(t.frames.size).toBe(0);
    expect(t.calls.every((c) => (c.options as { animate: boolean }).animate === false)).toBe(true);
    expect(t.map.pixelOf(under).x).toBeCloseTo(120, 6);
    expect(t.map.pixelOf(under).y).toBeCloseTo(80, 6);
    // Zoom is monotonic: no bounce.
    const zooms = t.calls.map((c) => c.zoom);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
  });

  it("keeps the same map position under the pointer through a long, slow pinch", () => {
    const t = setup({ zoom: 2, max: 6 });
    const under = t.map.at(600, 450);
    for (let i = 0; i < 120; i++) {
      t.wheel(-1, { ctrlKey: true, clientX: 600, clientY: 450 });
      t.frame();
    }
    t.runAll();
    expect(t.map.zoom).toBeCloseTo(3.2, 2);
    expect(t.map.pixelOf(under).x).toBeCloseTo(600, 6);
    expect(t.map.pixelOf(under).y).toBeCloseTo(450, 6);
  });

  it("anchors again when the pointer moves during a gesture", () => {
    const t = setup({ zoom: 3 });
    t.wheel(-60, { clientX: 100, clientY: 100 });
    t.frame();
    const under = t.map.at(500, 400);
    t.wheel(-60, { clientX: 500, clientY: 400 });
    t.runAll();
    expect(t.map.pixelOf(under).x).toBeCloseTo(500, 6);
    expect(t.map.pixelOf(under).y).toBeCloseTo(400, 6);
  });

  it("follows a pan made while easing instead of jumping back", () => {
    const t = setup({ zoom: 3 });
    t.wheel(-120, { clientX: 100, clientY: 100 });
    t.frame();
    t.map.center = { lat: -10, lng: 20 };
    const under = t.map.at(100, 100);
    t.runAll();
    expect(t.map.pixelOf(under).x).toBeCloseTo(100, 6);
    expect(t.map.pixelOf(under).y).toBeCloseTo(100, 6);
  });

  it("clamps the target to the limits so zoom stops at max and min without overshoot", () => {
    const t = setup({ zoom: 5.9, max: 6 });
    for (let i = 0; i < 20; i++) t.wheel(-500);
    t.runAll();
    expect(t.map.zoom).toBe(6);
    expect(Math.max(...t.calls.map((c) => c.zoom))).toBeLessThanOrEqual(6);
    // Zooming back out starts from the max at once, not from an accumulated target above it.
    t.wheel(30);
    t.frame();
    expect(t.map.zoom).toBeLessThan(6);
    t.runAll();
    for (let i = 0; i < 40; i++) t.wheel(500);
    t.runAll();
    expect(t.map.zoom).toBe(1);
    expect(Math.min(...t.calls.map((c) => c.zoom))).toBeGreaterThanOrEqual(1);
  });

  it("re-clamps the target when the limits change mid-ease (minZoom reset on resize)", () => {
    const t = setup({ zoom: 3, min: 1 });
    t.wheel(500);
    t.wheel(500);
    t.frame();
    t.map.min = 2.5;
    t.runAll();
    expect(t.map.zoom).toBe(2.5);
    expect(Math.min(...t.calls.slice(1).map((c) => c.zoom))).toBeGreaterThanOrEqual(2.5);
  });

  it("starts a new gesture from the map's current zoom", () => {
    const t = setup({ zoom: 3 });
    t.wheel(-30);
    t.runAll();
    t.map.zoom = 4; // e.g. a zoom button
    t.wheel(-30);
    t.runAll();
    expect(t.map.zoom).toBeCloseTo(4 + 30 * PIXEL_ZOOM_PER_PX, 2);
  });

  it("does nothing at a limit, and cancels the frame and listener on destroy", () => {
    const t = setup({ zoom: 6, max: 6 });
    t.wheel(-100);
    t.runAll();
    expect(t.calls).toHaveLength(0);
    t.wheel(100);
    expect(t.frames.size).toBe(1);
    t.handle.destroy();
    expect(t.frames.size).toBe(0);
    expect(t.cancelled).toHaveLength(1);
    expect(t.listeners.has("wheel")).toBe(false);
    t.handle.destroy();
  });
});
