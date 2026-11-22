/**
 * `TextFileView` for `.map` files (design D4, spec map-view "Map files open in
 * a map view" and map-file "Invalid files are never overwritten").
 *
 * The view keeps the last parse in memory. A valid map renders (for now) as a
 * placeholder summary; any parse failure renders an error state, and from an
 * error state nothing is ever written: `getViewData()` hands back the raw text
 * unchanged, and `save()` / `requestSave()` return early.
 */
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { parseMap, type ParseResult } from "../core/parse";
import { FEATURE_TYPES, type FeatureType, type MapDocument } from "../core/schema";
import { stringifyMap } from "../core/serialize";
import { VIEW_TYPE_MAP } from "./constants";

export type ParseFailure = Extract<ParseResult, { ok: false }>;

export type MapViewState =
  | { kind: "empty" }
  | { kind: "ok"; map: MapDocument }
  | { kind: "error"; failure: ParseFailure; raw: string };

const ERROR_TEXT: Record<ParseFailure["kind"], { heading: string; detail: string }> = {
  json: {
    heading: "This map file isn't valid JSON",
    detail: "Fix the JSON below and the map will reload. The file has not been changed.",
  },
  "not-mythical": {
    heading: "Not a Mythical map",
    detail: 'This file is JSON but has no "type": "mythical-map" marker, so it was left untouched.',
  },
  "future-version": {
    heading: "Made with a newer Mythical Maps",
    detail: "Upgrade the Mythical Maps plugin to open this map. The file has not been changed.",
  },
  invalid: {
    heading: "This map has errors",
    detail: "Fix the issues below and the map will reload. The file has not been changed.",
  },
};

const PLURALS: Record<FeatureType, [string, string]> = {
  pin: ["pin", "pins"],
  label: ["label", "labels"],
  region: ["region", "regions"],
  path: ["path", "paths"],
  folder: ["folder", "folders"],
};

/** Feature counts per type, e.g. "3 pins · 1 label · 1 region · 1 path · 2 folders". Zero counts are omitted. */
export function featureSummary(map: MapDocument): string {
  const counts = new Map<FeatureType, number>();
  for (const f of map.features) counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  const parts = FEATURE_TYPES.filter((t) => counts.has(t)).map((t) => {
    const n = counts.get(t) ?? 0;
    const [one, many] = PLURALS[t];
    return `${n} ${n === 1 ? one : many}`;
  });
  return parts.length > 0 ? parts.join(" · ") : "No features";
}

export class MapView extends TextFileView {
  private viewState: MapViewState = { kind: "empty" };

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    // `requestSave` is the base class's debounced function property: wrap it so
    // an error state can never schedule a write.
    const baseRequestSave = this.requestSave;
    this.requestSave = () => {
      if (this.viewState.kind !== "ok") return;
      baseRequestSave();
    };
  }

  /** Current parse state (read-only; for tests and later beads). */
  get mapState(): MapViewState {
    return this.viewState;
  }

  override getViewType(): string {
    return VIEW_TYPE_MAP;
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Map";
  }

  override getIcon(): string {
    return "map";
  }

  override getViewData(): string {
    switch (this.viewState.kind) {
      case "ok":
        return stringifyMap(this.viewState.map);
      case "error":
        return this.viewState.raw;
      case "empty":
        return this.data;
    }
  }

  override setViewData(data: string, _clear: boolean): void {
    const result = parseMap(data);
    this.viewState = result.ok ? { kind: "ok", map: result.map } : { kind: "error", failure: result, raw: data };
    this.render();
  }

  override clear(): void {
    this.viewState = { kind: "empty" };
    this.contentEl.empty();
  }

  /** Never write from an error (or empty) state: the file must stay untouched. */
  override async save(clear?: boolean): Promise<void> {
    if (this.viewState.kind !== "ok") return;
    await super.save(clear);
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("mythical-map-view");
    const state = this.viewState;
    if (state.kind === "ok") this.renderSummary(el, state.map);
    else if (state.kind === "error") this.renderError(el, state.failure);
  }

  private renderSummary(el: HTMLElement, map: MapDocument): void {
    const box = el.createDiv({ cls: "mythical-map-summary" });
    box.createEl("h3", { text: this.getDisplayText() });
    box.createEl("p", { cls: "mythical-map-image", text: `Image: ${map.image.path} (${map.image.width} × ${map.image.height})` });
    box.createEl("p", { cls: "mythical-map-counts", text: featureSummary(map) });
  }

  private renderError(el: HTMLElement, failure: ParseFailure): void {
    const { heading, detail } = ERROR_TEXT[failure.kind];
    const box = el.createDiv({ cls: ["mythical-map-error", `mythical-map-error-${failure.kind}`] });
    box.createEl("h3", { text: heading });
    box.createEl("p", { text: detail });
    const list = box.createEl("ul", { cls: "mythical-map-issues" });
    for (const issue of failure.issues) {
      list.createEl("li", { text: issue.path ? `${issue.path}: ${issue.message}` : issue.message });
    }
  }
}
