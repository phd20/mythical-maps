import { describe, expect, it } from "vitest";
import type { Feature, MapDocument } from "../src/core/schema";
import type { RenderView } from "../src/ui/featureRenderer";
import { createVisibilityRenderer, type ZoomState } from "../src/ui/visibility";

const model = (features: Feature[]): MapDocument => ({
  type: "mythical-map",
  version: 1,
  image: { path: "x.png", width: 512, height: 512 },
  features,
});

const features: Feature[] = [
  { id: "fhide001", type: "folder", rank: "a0", isHidden: true },
  { id: "fsub0001", type: "folder", rank: "a0", parentId: "fhide001" },
  { id: "pdeep001", type: "pin", rank: "a0", parentId: "fsub0001", pos: [0, 0] },
  { id: "pfree001", type: "pin", rank: "a1", pos: [0, 0] },
  { id: "lgate001", type: "label", rank: "a2", name: "Coast", pos: [0, 0], visibilityRange: [0.5, 1] },
];

function setup(state: ZoomState = { zoom: 0, limits: { min: 0, max: 4 } }) {
  const calls: { model: MapDocument; view: RenderView | undefined }[] = [];
  const vis = createVisibilityRenderer({ render: (m, v) => calls.push({ model: m, view: v }) }, () => state);
  /** Ids the last render call would draw. */
  const visible = (): string[] => {
    const last = calls.at(-1);
    if (!last) return [];
    return last.model.features.filter((f) => f.type !== "folder" && (last.view?.isVisible?.(f) ?? true)).map((f) => f.id);
  };
  return { state, calls, vis, visible };
}

describe("createVisibilityRenderer", () => {
  it("a hidden folder hides its descendants at any depth", () => {
    const { vis, visible } = setup();
    vis.render(model(features));
    expect(visible()).toEqual(["pfree001"]);
  });

  it("a zoom-gated label is hidden below the midpoint and shown from it", () => {
    const { state, vis, visible } = setup();
    vis.render(model(features));
    expect(visible()).not.toContain("lgate001");
    state.zoom = 2; // midpoint of [0, 4]
    vis.update();
    expect(visible()).toContain("lgate001");
    state.zoom = 1.99;
    vis.update();
    expect(visible()).not.toContain("lgate001");
  });

  it("update does not re-render while the visible set is unchanged", () => {
    const { state, calls, vis } = setup();
    vis.update(); // nothing rendered yet: no-op
    expect(calls).toHaveLength(0);
    vis.render(model(features));
    for (const z of [0.5, 1, 1.5, 1.9]) {
      state.zoom = z;
      vis.update();
    }
    expect(calls).toHaveLength(1);
    state.zoom = 3;
    vis.update();
    vis.update();
    expect(calls).toHaveLength(2);
  });

  it("render always re-renders (the model may have changed)", () => {
    const { calls, vis } = setup();
    const m = model(features);
    vis.render(m);
    vis.render(m);
    expect(calls).toHaveLength(2);
  });

  it("re-evaluates against new limits", () => {
    const { state, vis, visible } = setup({ zoom: 2, limits: { min: 0, max: 4 } });
    vis.render(model(features));
    expect(visible()).toContain("lgate001");
    state.limits = { min: 1, max: 4 }; // midpoint now 2.5
    vis.update();
    expect(visible()).not.toContain("lgate001");
  });

  it("ignores zoom ranges until limits are known, and keeps the caller's view", () => {
    const resolveStyle = () => {
      throw new Error("unused");
    };
    const { vis, visible, calls } = setup({ zoom: 0, limits: null });
    vis.render(model(features), { resolveStyle, isVisible: (f) => f.id !== "pfree001" });
    expect(visible()).toEqual(["lgate001"]);
    expect(calls[0]?.view?.resolveStyle).toBe(resolveStyle);
  });
});
