/**
 * Map toolbar (design D10, spec map-editing "Create features"): the editing
 * modes Select, Pin, Label, Region and Path, plus Fit.
 *
 * Built in the parent's own document (pop-out windows) with Obsidian's DOM
 * helpers; icons come through the injected `IconProvider`. The toolbar only
 * reports clicks: the view owns the mode.
 */
import type { IconProvider } from "./featureRenderer";

export const EDIT_MODES = ["select", "pin", "label", "region", "path"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export const MODE_BUTTONS: Record<EditMode, { icon: string; title: string }> = {
  select: { icon: "mouse-pointer-2", title: "Select" },
  pin: { icon: "map-pin", title: "Pin" },
  label: { icon: "type", title: "Label" },
  region: { icon: "pentagon", title: "Region" },
  path: { icon: "route", title: "Path" },
};
export const FIT_BUTTON = { icon: "maximize", title: "Fit map to view" };

/** What a plain map click creates: Pin mode a pin, Label mode a label; Shift-click always a pin. Null creates nothing. */
export function creationKindFor(mode: EditMode, shiftKey: boolean): "pin" | "label" | null {
  if (shiftKey) return "pin";
  return mode === "pin" ? "pin" : mode === "label" ? "label" : null;
}

export interface ToolbarOptions {
  mode: EditMode;
  icons: IconProvider;
  onMode(mode: EditMode): void;
  onFit(): void;
}

export interface ToolbarHandle {
  readonly el: HTMLElement;
  /** Highlight the button of `mode` (does not call `onMode`). */
  setMode(mode: EditMode): void;
  destroy(): void;
}

export function createToolbar(parent: HTMLElement, options: ToolbarOptions): ToolbarHandle {
  const el = parent.createDiv({ cls: "mythical-map-toolbar" });
  el.setAttribute("role", "toolbar");
  const buttons = new Map<EditMode, HTMLElement>();
  const makeButton = (spec: { icon: string; title: string }, onClick: () => void): HTMLElement => {
    const button = el.createEl("button", { cls: "mythical-map-tool" });
    button.setAttribute("aria-label", spec.title);
    button.setAttribute("title", spec.title);
    options.icons.set(button, spec.icon);
    button.addEventListener("click", onClick);
    return button;
  };
  for (const mode of EDIT_MODES) buttons.set(mode, makeButton(MODE_BUTTONS[mode], () => options.onMode(mode)));
  makeButton(FIT_BUTTON, () => options.onFit()).addClass("mythical-map-tool-fit");

  const setMode = (mode: EditMode): void => {
    for (const [m, button] of buttons) {
      button.toggleClass("is-active", m === mode);
      button.setAttribute("aria-pressed", String(m === mode));
    }
  };
  setMode(options.mode);
  return { el, setMode, destroy: () => el.remove() };
}
