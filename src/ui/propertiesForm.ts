/**
 * The properties form (bead 5.5, spec map-editing "Select and edit
 * properties"): fields for the selected feature, shown below the feature tree
 * in the panel.
 *
 * - Fields come from `core/properties.ts` (`fieldsFor`), per feature type, plus
 *   a two-input `visibilityRange`.
 * - A value is committed on `change` (Enter, blur, or picking an option) so a
 *   name edit is one undo step. Input is validated as it is typed: an invalid
 *   value shows an inline error, is never sent to `host.edit`, and the stored
 *   value stays unchanged until a valid value replaces it (Escape reverts).
 * - Every accepted change is an `update` op passed to `host.edit` (the view's
 *   `edit()`, so the lock is enforced at the model layer). The form never
 *   mutates the model and re-reads values from it on each `update`.
 * - All elements are created through the parent element, so they belong to its
 *   `ownerDocument` (pop-out windows).
 */
import type { ApplyResult } from "../core/document";
import {
  buildPatch,
  buildRangePatch,
  fieldsFor,
  fieldValue,
  rangeValue,
  validateField,
  validateRange,
  type FieldSpec,
  type RawValue,
} from "../core/properties";
import type { Feature, MapDocument } from "../core/schema";
import { DEFAULT_STYLES } from "../core/style";
import type { EditOp } from "../obsidian/mapView";

export interface PropertiesFormHost {
  /** Apply an edit op; not-ok results are refused (lock, invalid). */
  edit(op: EditOp): ApplyResult;
  /**
   * Open the note picker for a pin link (bead 6.1). `done` gets the chosen
   * linktext, or null to clear the link. Omitted: no "Choose…" button.
   */
  chooseLink?(current: string, done: (linktext: string | null) => void): void;
}

export const PROPERTIES_TITLE = "Properties";
export const RANGE_LABEL = "Visible between zoom";
export const RANGE_KEY = "visibilityRange";
export const CHOOSE_LINK_LABEL = "Choose…";
export const DEFAULT_OPTION_LABEL = "Default";

interface Control {
  /** Key used for the error slot and focus tracking. */
  key: string;
  inputs: Array<HTMLInputElement | HTMLSelectElement>;
  errorEl: HTMLElement;
  /** Set the inputs from the stored feature. */
  sync(feature: Feature): void;
  /** True while an error is showing for this control. */
  hasError: boolean;
}

export class PropertiesForm {
  readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private map: MapDocument | null = null;
  private selectedId: string | null = null;
  /** The feature id and type the controls were built for. */
  private builtFor: { id: string; type: string } | null = null;
  private controls: Control[] = [];
  private focusedInput: unknown = null;
  private destroyed = false;

  constructor(
    parent: HTMLElement,
    private readonly host: PropertiesFormHost,
  ) {
    this.el = parent.createDiv({ cls: "mythical-map-props" });
    this.el.toggleClass("is-empty", true);
    this.el.createDiv({ cls: "mythical-map-props-header", text: PROPERTIES_TITLE });
    this.bodyEl = this.el.createDiv({ cls: "mythical-map-props-body" });
  }

  /** Re-read the model; rebuilds only when the selection (or its type) changed. */
  update(map: MapDocument): void {
    this.map = map;
    this.render();
  }

  /** The selection changed (in the map or the tree). */
  setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.el.remove();
  }

  private current(): Feature | undefined {
    return this.selectedId === null ? undefined : this.map?.features.find((f) => f.id === this.selectedId);
  }

  private render(): void {
    if (this.destroyed) return;
    const feature = this.current();
    if (!feature) {
      this.builtFor = null;
      this.controls = [];
      this.bodyEl.empty();
      this.el.toggleClass("is-empty", true);
      return;
    }
    this.el.toggleClass("is-empty", false);
    if (this.builtFor?.id !== feature.id || this.builtFor.type !== feature.type) this.build(feature);
    else this.syncAll(feature);
  }

  private build(feature: Feature): void {
    this.builtFor = { id: feature.id, type: feature.type };
    this.controls = [];
    this.focusedInput = null;
    this.bodyEl.empty();
    for (const spec of fieldsFor(feature.type)) this.buildField(spec, feature);
    this.buildRange();
    this.syncAll(feature);
  }

  /** Refresh every control from the model, leaving the one being typed in alone. */
  private syncAll(feature: Feature): void {
    for (const control of this.controls) {
      if (control.hasError || control.inputs.some((i) => i === this.focusedInput)) continue;
      control.sync(feature);
    }
  }

  // --- field construction ---

  private row(label: string): { row: HTMLElement; errorEl: HTMLElement; field: HTMLElement } {
    const row = this.bodyEl.createDiv({ cls: "mythical-map-props-row" });
    row.createEl("label", { cls: "mythical-map-props-label", text: label });
    const field = row.createDiv({ cls: "mythical-map-props-field" });
    const errorEl = row.createDiv({ cls: "mythical-map-props-error" });
    return { row, errorEl, field };
  }

  private buildField(spec: FieldSpec, feature: Feature): void {
    const { row, errorEl, field } = this.row(spec.label);
    row.setAttribute("data-field", spec.key);
    let input: HTMLInputElement | HTMLSelectElement;
    if (spec.kind === "enum") {
      const select = field.createEl("select", { cls: "dropdown mythical-map-props-input" });
      select.createEl("option", { text: this.defaultLabel(spec, feature) }).value = "";
      for (const option of spec.options ?? []) select.createEl("option", { text: option }).value = option;
      input = select;
    } else if (spec.kind === "boolean") {
      const box = field.createEl("input", { cls: "mythical-map-props-input" });
      box.type = "checkbox";
      input = box;
    } else {
      const text = field.createEl("input", { cls: "mythical-map-props-input" });
      text.type = "text";
      const placeholder = this.defaultPlaceholder(spec, feature);
      if (placeholder !== "") text.placeholder = placeholder;
      input = text;
    }
    input.setAttribute("data-field-input", spec.key);
    const chooseLink = spec.key === "link" ? this.host.chooseLink?.bind(this.host) : undefined;
    const chooseButton = chooseLink ? field.createEl("button", { cls: "mythical-map-props-choose", text: CHOOSE_LINK_LABEL }) : null;

    const control: Control = {
      key: spec.key,
      inputs: [input],
      errorEl,
      hasError: false,
      sync: (f) => {
        const value = fieldValue(f, spec);
        if (spec.kind === "boolean") (input as HTMLInputElement).checked = value === true;
        else input.value = String(value);
      },
    };
    this.controls.push(control);
    this.trackFocus(input);

    const read = (): RawValue => (spec.kind === "boolean" ? (input as HTMLInputElement).checked : input.value);
    // Live feedback while typing: show the error, or clear it once the value is valid again.
    input.addEventListener("input", () => {
      if (spec.kind === "boolean" || spec.kind === "enum") return;
      const result = validateField(spec, read());
      if (result.ok) this.clearError(control);
      else this.showError(control, result.error);
    });
    input.addEventListener("change", () => this.commitField(spec, control, read()));
    chooseButton?.setAttribute("data-field-choose", spec.key);
    chooseButton?.addEventListener("click", () => {
      chooseLink?.(input.value, (linktext) => {
        input.value = linktext ?? "";
        this.clearError(control);
        this.commitField(spec, control, input.value);
      });
    });
    input.addEventListener("keydown", (evt) => {
      if ((evt as KeyboardEvent).key === "Escape" && spec.kind !== "boolean" && spec.kind !== "enum") this.revert(control);
    });
  }

  private buildRange(): void {
    const { row, errorEl, field } = this.row(RANGE_LABEL);
    row.setAttribute("data-field", RANGE_KEY);
    const make = (placeholder: string, key: string) => {
      const input = field.createEl("input", { cls: "mythical-map-props-input mythical-map-props-range" });
      input.type = "text";
      input.placeholder = placeholder;
      input.setAttribute("data-field-input", key);
      this.trackFocus(input);
      return input;
    };
    const minInput = make("min 0", `${RANGE_KEY}.min`);
    const maxInput = make("max 1", `${RANGE_KEY}.max`);
    const control: Control = {
      key: RANGE_KEY,
      inputs: [minInput, maxInput],
      errorEl,
      hasError: false,
      sync: (f) => {
        const [min, max] = rangeValue(f);
        minInput.value = min;
        maxInput.value = max;
      },
    };
    this.controls.push(control);
    for (const input of [minInput, maxInput]) {
      input.addEventListener("input", () => {
        const result = validateRange(minInput.value, maxInput.value);
        if (result.ok) this.clearError(control);
        else this.showError(control, result.error);
      });
      input.addEventListener("change", () => this.commitRange(control, minInput.value, maxInput.value));
      input.addEventListener("keydown", (evt) => {
        if ((evt as KeyboardEvent).key === "Escape") this.revert(control);
      });
    }
  }

  private trackFocus(input: HTMLInputElement | HTMLSelectElement): void {
    input.addEventListener("focus", () => {
      this.focusedInput = input;
    });
    input.addEventListener("blur", () => {
      if (this.focusedInput === input) this.focusedInput = null;
      // A change that was applied while focused is shown now.
      const feature = this.current();
      if (feature) this.syncAll(feature);
    });
  }

  // --- placeholders ---

  private defaultPlaceholder(spec: FieldSpec, feature: Feature): string {
    if (spec.key === "link") return "Note name or path";
    if (spec.key === "name") return "Untitled";
    if (spec.scope !== "style") return "";
    const defaults = DEFAULT_STYLES[feature.type] as Record<string, unknown>;
    const value = defaults[spec.key];
    return value === undefined ? "" : String(value);
  }

  private defaultLabel(spec: FieldSpec, feature: Feature): string {
    if (spec.key === "labelVisibility") return `${DEFAULT_OPTION_LABEL} (${DEFAULT_LABEL_VISIBILITY})`;
    const placeholder = this.defaultPlaceholder(spec, feature);
    return placeholder === "" ? DEFAULT_OPTION_LABEL : `${DEFAULT_OPTION_LABEL} (${placeholder})`;
  }

  // --- committing ---

  private commitField(spec: FieldSpec, control: Control, raw: RawValue): void {
    const feature = this.current();
    if (!feature) return;
    const result = validateField(spec, raw);
    if (!result.ok) {
      this.showError(control, result.error);
      return; // the stored value is unchanged
    }
    this.clearError(control);
    const stored = fieldValue(feature, spec);
    const next = spec.kind === "boolean" ? result.value === true : String(result.value ?? "");
    if (next === stored) {
      control.sync(feature); // e.g. trimmed whitespace
      return;
    }
    this.applyEdit(feature.id, buildPatch(feature, spec, result.value), control);
  }

  private commitRange(control: Control, minRaw: string, maxRaw: string): void {
    const feature = this.current();
    if (!feature) return;
    const result = validateRange(minRaw, maxRaw);
    if (!result.ok) {
      this.showError(control, result.error);
      return;
    }
    this.clearError(control);
    const [min, max] = rangeValue(feature);
    const next = result.value;
    if ((next === undefined && min === "" && max === "") || (next !== undefined && String(next[0]) === min && String(next[1]) === max)) {
      control.sync(feature);
      return;
    }
    this.applyEdit(feature.id, buildRangePatch(next), control);
  }

  private applyEdit(id: string, patch: ReturnType<typeof buildPatch>, control: Control): void {
    const result = this.host.edit({ type: "update", id, patch });
    if (result.ok) return;
    // Refused (locked map, invalid result): keep the stored value and say why.
    this.showError(control, result.error);
    const feature = this.current();
    if (feature) control.sync(feature);
  }

  // --- errors ---

  private showError(control: Control, message: string): void {
    control.hasError = true;
    control.errorEl.setText(message);
    for (const input of control.inputs) {
      input.toggleClass("is-invalid", true);
      input.setAttribute("aria-invalid", "true");
    }
  }

  private clearError(control: Control): void {
    if (!control.hasError) return;
    control.hasError = false;
    control.errorEl.setText("");
    for (const input of control.inputs) {
      input.toggleClass("is-invalid", false);
      input.setAttribute("aria-invalid", "false");
    }
  }

  /** Drop what was typed and show the stored value again. */
  private revert(control: Control): void {
    this.clearError(control);
    const feature = this.current();
    if (feature) control.sync(feature);
  }
}

const DEFAULT_LABEL_VISIBILITY = "always";
