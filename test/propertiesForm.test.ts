import { beforeAll, describe, expect, it } from "vitest";
import { MockElement } from "./mocks/obsidian";
import { MapStore, type ApplyResult } from "../src/core/document";
import type { Feature, MapDocument } from "../src/core/schema";
import { PropertiesForm } from "../src/ui/propertiesForm";
import type { EditOp } from "../src/obsidian/mapView";

// The shared mock element is minimal; add the few DOM members the form touches.
beforeAll(() => {
  const proto = MockElement.prototype as unknown as Record<string, unknown>;
  proto.setText ??= function (this: MockElement, text: string) {
    this.text = text;
  };
  for (const name of ["remove", "focus"]) proto[name] ??= function () {};
});

type Input = MockElement & { value: string; checked: boolean };

const pin = (id: string, extra: Partial<Feature> = {}): Feature =>
  ({ id, type: "pin", rank: "a0", name: "Inn", pos: [1, 1], style: { iconColor: "#112233" }, ...extra }) as Feature;
const doc = (features: Feature[]): MapDocument =>
  ({ type: "mythical-map", version: 1, image: { path: "a.png", width: 10, height: 10 }, features }) as unknown as MapDocument;

function setup(features: Feature[], selected: string | null = "pinaaaaa") {
  const store = new MapStore(doc(features));
  const ops: EditOp[] = [];
  const parent = new MockElement() as unknown as HTMLElement;
  const form = new PropertiesForm(parent, {
    edit: (op): ApplyResult => {
      ops.push(op);
      return store.apply(op);
    },
  });
  store.subscribe((map) => form.update(map));
  form.update(store.map);
  form.setSelected(selected);
  const root = form.el as unknown as MockElement;
  const input = (key: string): Input => {
    const found = root.findAll((e) => e.attributes["data-field-input"] === key)[0];
    if (!found) throw new Error(`no input ${key}`);
    return found as Input;
  };
  const fire = (el: MockElement, type: string, evt: object = {}) => {
    for (const cb of el.listeners[type] ?? []) cb({ type, ...evt });
  };
  /** Type a value into a field and commit it, as a user does. */
  const enter = (key: string, value: string) => {
    const el = input(key);
    el.value = value;
    fire(el, "input");
    fire(el, "change");
  };
  const error = (key: string) =>
    root.findAll((e) => e.attributes["data-field"] === key)[0]?.findAll((e) => e.classes.has("mythical-map-props-error"))[0]?.text ?? "";
  const stored = (): Feature => store.map.features[0] as Feature;
  return { store, form, ops, root, input, enter, fire, error, stored };
}

describe("PropertiesForm", () => {
  it("is empty without a selection and shows the selected feature's fields", () => {
    const t = setup([pin("pinaaaaa")], null);
    expect(t.root.classes.has("is-empty")).toBe(true);
    t.form.setSelected("pinaaaaa");
    expect(t.root.classes.has("is-empty")).toBe(false);
    expect(t.input("name").value).toBe("Inn");
    expect(t.input("iconColor").value).toBe("#112233");
    expect(t.input("link")).toBeDefined();
    expect(t.input("isHidden")).toBeDefined();
    expect(t.input("visibilityRange.min")).toBeDefined();
    t.form.setSelected(null);
    expect(t.root.classes.has("is-empty")).toBe(true);
  });

  it("shows per-type fields (a region has fill opacity, no link)", () => {
    const region = { id: "regaaaaa", type: "region", rank: "a0", polygon: [[0, 0], [0, 1], [1, 1]] } as Feature;
    const t = setup([region], "regaaaaa");
    expect(t.input("fillOpacity")).toBeDefined();
    expect(() => t.input("link")).toThrow();
  });

  it("renames a pin live: one update op, stored in the model", () => {
    const t = setup([pin("pinaaaaa")]);
    t.enter("name", "  Tavern ");
    expect(t.ops).toEqual([{ type: "update", id: "pinaaaaa", patch: { name: "Tavern" } }]);
    expect(t.stored().name).toBe("Tavern");
    expect(t.input("name").value).toBe("Tavern");
  });

  it("clears a name when emptied", () => {
    const t = setup([pin("pinaaaaa")]);
    t.enter("name", "");
    expect("name" in t.stored()).toBe(false);
  });

  it("rejects an invalid colour: inline error, no edit, stored value unchanged", () => {
    const t = setup([pin("pinaaaaa")]);
    const el = t.input("iconColor");
    el.value = "blue";
    t.fire(el, "input");
    expect(t.error("iconColor")).toMatch(/#RRGGBB/);
    expect(el.classes.has("is-invalid")).toBe(true);
    t.fire(el, "change");
    expect(t.ops).toEqual([]);
    expect(t.stored().style).toEqual({ iconColor: "#112233" });
    // The error survives an unrelated model update, then clears when a valid colour is entered.
    t.form.update(t.store.map);
    expect(el.value).toBe("blue");
    t.enter("iconColor", "#ff0000");
    expect(t.error("iconColor")).toBe("");
    expect(el.classes.has("is-invalid")).toBe(false);
    expect(t.stored().style).toEqual({ iconColor: "#ff0000" });
  });

  it("Escape drops an invalid entry and shows the stored value", () => {
    const t = setup([pin("pinaaaaa")]);
    const el = t.input("iconColor");
    el.value = "nope";
    t.fire(el, "input");
    t.fire(el, "keydown", { key: "Escape" });
    expect(el.value).toBe("#112233");
    expect(t.error("iconColor")).toBe("");
  });

  it("sets style enums and clears them with the default option", () => {
    const t = setup([pin("pinaaaaa")]);
    t.enter("iconShape", "flag");
    expect(t.stored().style).toEqual({ iconColor: "#112233", iconShape: "flag" });
    t.enter("iconShape", "");
    expect(t.stored().style).toEqual({ iconColor: "#112233" });
  });

  it("toggles isHidden with the checkbox, removing the key when unchecked", () => {
    const t = setup([pin("pinaaaaa")]);
    const box = t.input("isHidden");
    box.checked = true;
    t.fire(box, "change");
    expect(t.stored().isHidden).toBe(true);
    box.checked = false;
    t.fire(box, "change");
    expect("isHidden" in t.stored()).toBe(false);
  });

  it("applies a valid visibilityRange and rejects inverted or out-of-range ones", () => {
    const t = setup([pin("pinaaaaa")]);
    const min = t.input("visibilityRange.min");
    const max = t.input("visibilityRange.max");
    min.value = "0.2";
    max.value = "0.8";
    t.fire(min, "change");
    expect(t.stored().visibilityRange).toEqual([0.2, 0.8]);

    min.value = "0.9"; // inverted
    t.fire(min, "input");
    t.fire(min, "change");
    expect(t.error("visibilityRange")).toMatch(/Minimum/);
    expect(t.stored().visibilityRange).toEqual([0.2, 0.8]);

    max.value = "1.5"; // out of range
    t.fire(max, "input");
    expect(t.error("visibilityRange")).toMatch(/between 0 and 1/);
    t.fire(max, "change");
    expect(t.stored().visibilityRange).toEqual([0.2, 0.8]);

    min.value = "";
    max.value = "";
    t.fire(max, "input");
    t.fire(max, "change");
    expect("visibilityRange" in t.stored()).toBe(false);
    expect(t.error("visibilityRange")).toBe("");
  });

  it("keeps the stored value and shows the reason when the edit is refused (locked map)", () => {
    const t = setup([pin("pinaaaaa")]);
    t.store.lock();
    t.enter("name", "Tavern");
    expect(t.stored().name).toBe("Inn");
    expect(t.error("name")).not.toBe("");
    expect(t.input("name").value).toBe("Inn");
  });

  it("follows model changes made elsewhere (undo) and the selection", () => {
    const t = setup([pin("pinaaaaa"), pin("pinbbbbb", { name: "Smithy", rank: "a1" })]);
    t.enter("name", "Tavern");
    t.store.undo();
    expect(t.input("name").value).toBe("Inn");
    t.form.setSelected("pinbbbbb");
    expect(t.input("name").value).toBe("Smithy");
  });
});
