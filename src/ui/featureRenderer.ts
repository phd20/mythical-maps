/**
 * Feature renderer (design D5, spec map-view "Feature rendering").
 *
 * One `render(model, view)` call draws every drawable feature of the model,
 * reusing Leaflet layers by feature id: a feature whose type is unchanged keeps
 * its layer, which is updated in place (`setLatLng`, `setIcon`, `setLatLngs`,
 * `setStyle`); new features get new layers; layers of features that are gone
 * (or no longer visible) are removed. Folders draw nothing.
 *
 * - Pins: `L.marker` with a `divIcon` holding the shape (coloured by
 *   `iconColor`, sized by `iconSize`) and the Lucide glyph via the injected
 *   `IconProvider`; an unknown glyph falls back to a dot.
 * - Labels: `L.marker` with a text `divIcon` (size, colour, text effect).
 * - Regions: `L.polygon` (fill opacity/style, border style).
 * - Paths: `L.polyline` (colour, width, stroke style, opacity).
 * - Names of pins, regions and paths are tooltips per `labelVisibility`:
 *   `always` → permanent, `hover` → on hover, `never` → none.
 *
 * The model is the only state: nothing is read back out of Leaflet. DOM nodes
 * are created in the map container's own document (pop-out windows).
 * Visibility (hidden folders, zoom ranges) is decided by `view.isVisible`,
 * supplied by bead 4.4; by default everything is visible.
 *
 * Interactions (bead 6.2): optional `deps.interactions` hooks are attached once
 * per layer (`mouseover` → `onHover`, `click` → `onClick`). Layers are reused
 * across renders, so a handler looks the feature up by id at event time and
 * always passes the feature from the latest `render`.
 */
import * as L from "leaflet";
import type { Feature, LabelFeature, LatLng, MapDocument, PathFeature, PinFeature, RegionFeature } from "../core/schema";
import {
  DEFAULT_STYLES,
  resolveStyle,
  type ResolvedLabelStyle,
  type ResolvedPathStyle,
  type ResolvedPinStyle,
  type ResolvedRegionStyle,
  type ResolvedStyle,
} from "../core/style";

/** Draws Lucide/Obsidian icons; injected so the renderer is testable without Obsidian. */
export interface IconProvider {
  /** True when `name` is a known icon. */
  has(name: string): boolean;
  /** Render icon `name` into `el` (Obsidian's `setIcon`). */
  set(el: HTMLElement, name: string): void;
}

/** What rendering needs beyond the model. Every field is optional. */
export interface RenderView {
  /** Resolved style for a feature; defaults to `resolveStyle` with the plugin defaults and no overrides. */
  resolveStyle?: (feature: Feature) => ResolvedStyle;
  /** Whether a feature is drawn (bead 4.4: hidden folders, zoom ranges); defaults to all visible. */
  isVisible?: (feature: Feature) => boolean;
  /** Whether a pin shows the "has map" indicator (bead 6.3: its note lists maps); defaults to none. */
  hasMap?: (feature: Feature) => boolean;
  /** Whether a pin shows the broken-link badge (bead 6.6: its `link` does not resolve); defaults to none. */
  isBroken?: (feature: Feature) => boolean;
}

/** Pointer hooks on drawn features (bead 6.2). Each receives the feature as of the latest render. */
export interface FeatureInteractions {
  /** Pointer entered a feature's layer; `targetEl` is the layer's DOM element (for `hover-link`). */
  onHover?(feature: Feature, event: MouseEvent, targetEl: HTMLElement | null): void;
  /** A feature's layer was clicked. */
  onClick?(feature: Feature, event: MouseEvent): void;
  /** A feature's layer was right-clicked (bead 6.3). */
  onContextMenu?(feature: Feature, event: MouseEvent): void;
}

export interface FeatureRendererDeps {
  icons: IconProvider;
  /** Hover and click hooks (bead 6.2); none by default. */
  interactions?: FeatureInteractions;
  /** Document to build DOM in; defaults to the map container's `ownerDocument`. */
  ownerDocument?: Document;
}

export interface FeatureRenderer {
  render(model: MapDocument, view?: RenderView): void;
  /** The layer drawn for a feature id, if any (for popups, selection, tests). */
  layerFor(id: string): L.Layer | undefined;
  /** Remove every feature layer. Idempotent; `render` after `destroy` is a no-op. */
  destroy(): void;
}

export type LabelVisibility = "always" | "hover" | "never";
export const DEFAULT_LABEL_VISIBILITY: LabelVisibility = "always";

/** Region border weight in pixels. */
export const REGION_BORDER_WEIGHT = 2;

/** Pin icon box size in pixels per `iconSize`. */
export const PIN_SIZES = { medium: 32, small: 24 } as const;

/** Shapes whose tip sits at the bottom centre; the rest are anchored at their centre. */
const BOTTOM_ANCHORED = new Set(["pin", "marker", "shield", "flag", "banner", "arch"]);

/** Leaflet `dashArray` for a line style, scaled by line weight. `undefined` means solid. */
export function dashArrayFor(style: "solid" | "dashed" | "dotted" | "none", weight: number): string | undefined {
  const w = Math.max(1, weight);
  if (style === "dashed") return `${w * 3} ${w * 2}`;
  if (style === "dotted") return `1 ${w * 2}`;
  return undefined;
}

export function regionPathOptions(style: ResolvedRegionStyle): L.PathOptions {
  const border = style.borderStyle;
  const fill = style.fillStyle !== "none";
  return {
    color: style.color,
    fillColor: style.color,
    stroke: border !== "none",
    weight: border === "none" ? 0 : REGION_BORDER_WEIGHT,
    dashArray: dashArrayFor(border, REGION_BORDER_WEIGHT),
    lineCap: border === "dotted" ? "round" : "butt",
    fill,
    fillOpacity: fill ? style.fillOpacity : 0,
    // striped/dotted fills get a class hook; SVG patterns are not drawn yet.
    className: `mythical-map-region mythical-map-fill-${style.fillStyle}`,
  };
}

export function pathPathOptions(style: ResolvedPathStyle): L.PolylineOptions {
  return {
    color: style.color,
    weight: style.strokeWidth,
    opacity: style.strokeOpacity,
    dashArray: dashArrayFor(style.strokeStyle, style.strokeWidth),
    lineCap: style.strokeStyle === "dotted" ? "round" : "butt",
    fill: false,
    className: "mythical-map-path",
  };
}

type TextStyle = Pick<ResolvedLabelStyle, "labelSize" | "textColor" | "textEffect" | "textEffectColor">;

type Kind = "pin" | "label" | "region" | "path";

interface Entry {
  kind: Kind;
  layer: L.Marker | L.Polyline<GeoJSON.LineString | GeoJSON.MultiLineString | GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  /** Signature of what built the current icon (markers) — rebuilt only when it changes. */
  iconKey?: string;
  /** Signature of the bound name tooltip, or "" when none. */
  tooltipKey: string;
}

const defaultResolve = (feature: Feature): ResolvedStyle => resolveStyle(feature, DEFAULT_STYLES, { enabled: false });

export function createFeatureRenderer(map: L.Map, deps: FeatureRendererDeps): FeatureRenderer {
  const entries = new Map<string, Entry>();
  /** The feature each drawn layer belongs to, as of the latest render (read by event handlers). */
  const current = new Map<string, Feature>();
  let destroyed = false;

  const doc = (): Document => deps.ownerDocument ?? map.getContainer().ownerDocument;

  function el(tag: string, cls: string): HTMLElement {
    const node = doc().createElement(tag);
    node.className = cls;
    return node;
  }

  function textEl(text: string, style: TextStyle, cls: string): HTMLElement {
    const node = el("div", `${cls} mythical-map-text-${style.labelSize} mythical-map-text-effect-${style.textEffect}`);
    node.textContent = text;
    node.style.setProperty("--mythical-map-text-color", style.textColor);
    node.style.setProperty("--mythical-map-text-effect-color", style.textEffectColor);
    return node;
  }

  function pinIcon(style: ResolvedPinStyle, hasMap: boolean, broken: boolean): L.DivIcon {
    const size = PIN_SIZES[style.iconSize];
    const root = el("div", `mythical-map-pin mythical-map-pin-${style.iconShape} mythical-map-pin-${style.iconSize}`);
    if (hasMap) {
      root.className += " mythical-map-pin-has-map";
      const badge = el("div", "mythical-map-pin-map-badge");
      if (deps.icons.has("map")) deps.icons.set(badge, "map");
      root.appendChild(badge);
    }
    if (broken) {
      root.className += " mythical-map-pin-broken";
      const badge = el("div", "mythical-map-pin-broken-badge");
      if (deps.icons.has("unlink")) deps.icons.set(badge, "unlink");
      root.appendChild(badge);
    }
    root.style.setProperty("--mythical-map-pin-color", style.iconColor);
    if (style.iconShape !== "none") root.appendChild(el("div", "mythical-map-pin-shape"));
    const glyph = el("div", "mythical-map-pin-glyph");
    if (deps.icons.has(style.iconGlyph)) {
      deps.icons.set(glyph, style.iconGlyph);
    } else {
      glyph.appendChild(el("span", "mythical-map-pin-dot"));
    }
    root.appendChild(glyph);
    const bottom = BOTTOM_ANCHORED.has(style.iconShape);
    return L.divIcon({
      html: root,
      className: "mythical-map-marker",
      iconSize: [size, size],
      iconAnchor: [size / 2, bottom ? size : size / 2],
      tooltipAnchor: [0, bottom ? 0 : size / 2],
    });
  }

  function labelIcon(text: string, style: ResolvedLabelStyle): L.DivIcon {
    // Zero-size icon anchored at `pos`; CSS centres the text on that point.
    return L.divIcon({
      html: textEl(text, style, "mythical-map-label"),
      className: "mythical-map-marker mythical-map-label-marker",
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  /** Bind, rebind or remove the name tooltip so it matches `labelVisibility`. */
  function syncTooltip(entry: Entry, feature: Feature, text: TextStyle): void {
    const name = feature.name?.trim() ?? "";
    const vis: LabelVisibility = feature.labelVisibility ?? DEFAULT_LABEL_VISIBILITY;
    const key = name === "" || vis === "never" ? "" : JSON.stringify([name, vis, text]);
    if (key === entry.tooltipKey) return;
    if (entry.tooltipKey !== "") entry.layer.unbindTooltip();
    entry.tooltipKey = key;
    if (key === "") return;
    const isMarker = entry.kind === "pin";
    entry.layer.bindTooltip(textEl(name, text, "mythical-map-name"), {
      permanent: vis === "always",
      direction: isMarker ? "bottom" : "center",
      className: "mythical-map-tooltip",
      opacity: 1,
    });
  }

  function drawPin(f: PinFeature, style: ResolvedPinStyle, hasMap: boolean, broken: boolean, prev: Entry | undefined): Entry {
    const key = JSON.stringify([style, hasMap, broken]);
    if (prev && prev.kind === "pin") {
      const marker = prev.layer as L.Marker;
      marker.setLatLng(f.pos);
      if (prev.iconKey !== key) {
        marker.setIcon(pinIcon(style, hasMap, broken));
        prev.iconKey = key;
      }
      return prev;
    }
    const marker = L.marker(f.pos, { icon: pinIcon(style, hasMap, broken), keyboard: false });
    return { kind: "pin", layer: marker, iconKey: key, tooltipKey: "" };
  }

  function drawLabel(f: LabelFeature, style: ResolvedLabelStyle, prev: Entry | undefined): Entry {
    const text = f.name ?? "";
    const key = JSON.stringify([text, style]);
    if (prev && prev.kind === "label") {
      const marker = prev.layer as L.Marker;
      marker.setLatLng(f.pos);
      if (prev.iconKey !== key) {
        marker.setIcon(labelIcon(text, style));
        prev.iconKey = key;
      }
      return prev;
    }
    const marker = L.marker(f.pos, { icon: labelIcon(text, style), keyboard: false });
    return { kind: "label", layer: marker, iconKey: key, tooltipKey: "" };
  }

  function drawRegion(f: RegionFeature, style: ResolvedRegionStyle, prev: Entry | undefined): Entry {
    // `polygons` is several polygons (a multipolygon), not one polygon with holes.
    const latlngs: LatLng[][] | LatLng[][][] = f.polygons ? f.polygons.map((p) => [p]) : [f.polygon ?? []];
    const options = regionPathOptions(style);
    if (prev && prev.kind === "region") {
      const polygon = prev.layer as L.Polygon;
      polygon.setLatLngs(latlngs);
      polygon.setStyle(options);
      return prev;
    }
    return { kind: "region", layer: L.polygon(latlngs, options), tooltipKey: "" };
  }

  function drawPath(f: PathFeature, style: ResolvedPathStyle, prev: Entry | undefined): Entry {
    const options = pathPathOptions(style);
    if (prev && prev.kind === "path") {
      const line = prev.layer as L.Polyline;
      line.setLatLngs(f.polyline);
      line.setStyle(options);
      return prev;
    }
    return { kind: "path", layer: L.polyline(f.polyline, options), tooltipKey: "" };
  }

  function draw(
    f: Exclude<Feature, { type: "folder" }>,
    style: ResolvedStyle,
    hasMap: boolean,
    broken: boolean,
    prev: Entry | undefined,
  ): Entry {
    switch (f.type) {
      case "pin": {
        const entry = drawPin(f, style as ResolvedPinStyle, hasMap, broken, prev);
        syncTooltip(entry, f, DEFAULT_STYLES.label);
        return entry;
      }
      case "label":
        // A label's text is its name; it has no separate name tooltip.
        return drawLabel(f, style as ResolvedLabelStyle, prev);
      case "region": {
        const s = style as ResolvedRegionStyle;
        const entry = drawRegion(f, s, prev);
        syncTooltip(entry, f, s);
        return entry;
      }
      case "path": {
        const s = style as ResolvedPathStyle;
        const entry = drawPath(f, s, prev);
        syncTooltip(entry, f, s);
        return entry;
      }
    }
  }

  function removeEntry(id: string): void {
    entries.get(id)?.layer.remove();
    entries.delete(id);
    current.delete(id);
  }

  /** Attach the interaction hooks to a new layer; handlers read the feature by id at event time. */
  function attachInteractions(id: string, layer: Entry["layer"]): void {
    const hooks = deps.interactions;
    if (!hooks) return;
    layer.on("mouseover", (e: L.LeafletEvent) => {
      const f = current.get(id);
      const event = (e as L.LeafletMouseEvent).originalEvent;
      if (!f || !hooks.onHover || !event) return;
      const target = (layer.getElement?.() as HTMLElement | undefined) ?? (event.target as HTMLElement | null);
      hooks.onHover(f, event, target ?? null);
    });
    layer.on("click", (e: L.LeafletEvent) => {
      const f = current.get(id);
      const event = (e as L.LeafletMouseEvent).originalEvent;
      if (f && hooks.onClick && event) hooks.onClick(f, event);
    });
    layer.on("contextmenu", (e: L.LeafletEvent) => {
      const f = current.get(id);
      const event = (e as L.LeafletMouseEvent).originalEvent;
      if (f && hooks.onContextMenu && event) hooks.onContextMenu(f, event);
    });
  }

  return {
    render(model, view = {}) {
      if (destroyed) return;
      // Dev-only timing (bead 8.1): set `window.__MM_PERF__ = true` in dev tools to log render time.
      const perf = (globalThis as { __MM_PERF__?: boolean }).__MM_PERF__ === true;
      const t0 = perf ? performance.now() : 0;
      const resolve = view.resolveStyle ?? defaultResolve;
      const isVisible = view.isVisible ?? (() => true);
      const keep = new Set<string>();
      for (const f of model.features) {
        if (f.type === "folder" || !isVisible(f)) continue;
        keep.add(f.id);
        current.set(f.id, f);
        const prev = entries.get(f.id);
        const entry = draw(f, resolve(f), f.type === "pin" && (view.hasMap?.(f) ?? false), f.type === "pin" && (view.isBroken?.(f) ?? false), prev);
        if (entry !== prev) {
          prev?.layer.remove();
          attachInteractions(f.id, entry.layer);
          entry.layer.addTo(map);
          entries.set(f.id, entry);
        }
      }
      for (const id of [...entries.keys()]) if (!keep.has(id)) removeEntry(id);
      if (perf) console.debug(`[mythical-maps] render: ${keep.size} features in ${(performance.now() - t0).toFixed(1)} ms`);
    },
    layerFor: (id) => entries.get(id)?.layer,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const id of [...entries.keys()]) removeEntry(id);
    },
  };
}
