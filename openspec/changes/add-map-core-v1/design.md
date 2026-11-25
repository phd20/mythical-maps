## Context

The repo is greenfield. The prior art and the lessons drawn from it:

- **Zoom Map (Jareika/zoom-map):** a feature-rich plugin with a custom renderer. Its map is declared in a ```` ```zoommap ```` code block, and its data lives in a `<image>.markers.json` sidecar or inline in a `%%` comment. Its `map.ts` has grown to about 467 KB, which shows the cost of a hand-built renderer.
- **Obsidian Leaflet (javalent):** also code-block based. It is in maintenance mode because of the maintainer's workload, not a technical failure. Its open bugs list the traps to avoid: pan and drag break in pop-out windows, marker names don't follow note renames, filenames with commas break its mini-syntax, markers stored in `data.json` were lost on exit, and the first render had the wrong size or zoom.
- **LegendKeeper v3 API (reference only, no integration):** a map is a document owned by a resource. It has `mapImage {width, height, bounds, tiles}` and `features[]` of type `pin | label | region | path | folder`, using `pos` / `polygon(s)` / `polyline` in a Leaflet `CRS.Simple` frame. Features carry `parentId`, a fractional-index `rank`, `visibilityRange` (0–1), a `uri` link to an article, and styling fields. Pages reference maps rather than defining them.

User constraints: no map syntax in notes in v1, and never markdown as the source of map data. Notes are rarely changed outside Obsidian, though Claude may change them. Native backlinks are not needed. Images up to about 8k pixels. Desktop first.

## Goals / Non-Goals

**Goals:**
- A `.map` file that is the only source of truth, and that both humans and Claude can read and diff.
- A coordinate frame that is identical to LegendKeeper's, so tiling and imports can be added later without migrating data.
- A reliable Leaflet-based view and editor, avoiding the known Obsidian Leaflet failures.
- Pin links that survive renames inside Obsidian, and are detectably broken (never silently lost) after renames outside it.
- An architecture that splits into small, independently testable units for loop and bead implementation.

**Non-Goals:**
- Embeds, fog of war, measurement, multiple bases or overlays, tiling, drawing, grids, an "on maps" panel, LegendKeeper sync, and backlinks or graph integration.
- Verified mobile support.

## Decisions

### D1. Layered architecture: pure core, Obsidian adapter, Leaflet UI

```
src/
  core/        pure TS, no `obsidian`/`leaflet` imports → unit-tested in vitest
    schema.ts       zod schema + types, version + migrate()
    serialize.ts    parse(text) / stringify(map) deterministic
    frame.ts        pixelToPos / posToPixel / zoom z
    ids.ts          cuid2-shaped id gen; rank via fractional-indexing
    features.ts     tree ops (children, move, delete subtree, visibility)
    links.ts        link rewrite on rename, broken-link scan (resolver injected)
    style.ts        style resolution (feature → override → defaults)
  obsidian/    adapters: plugin entry, settings, TextFileView, commands, vault index
  ui/          Leaflet layers, editing (geoman), popups, toolbar
```

The core takes a `LinkResolver` interface (`resolve(linktext, sourcePath) → path | null`) and a `FrontmatterReader` interface, so link and style logic can be tested without Obsidian.

*Alternative:* a single module tree like Zoom Map's. Rejected because it can't be unit-tested and doesn't split into beads.

### D2. File format: `.map`, versioned JSON

```json
{
  "type": "mythical-map",
  "version": 1,
  "image": { "path": "Maps/westmarch.webp", "width": 8192, "height": 6144 },
  "viewport": { "center": [-12, 16], "zoom": 2 },
  "features": [
    { "id": "k3x9q2mz", "type": "folder", "name": "Towns", "rank": "a0", "isHidden": false },
    { "id": "p7d1w0ab", "type": "pin", "name": "Rusty Flagon", "parentId": "k3x9q2mz", "rank": "a0",
      "pos": [-10.5, 14.25], "link": "Rusty Flagon",
      "style": { "iconGlyph": "beer-mug", "iconColor": "#A7A7A7", "iconShape": "pin", "iconSize": "medium" },
      "visibilityRange": [0, 1] }
  ]
}
```

- The image `path` is vault-relative, and the plugin's rename listener keeps it up to date.
- Field names follow LegendKeeper's `Feature` wherever they mean the same thing (`pos`, `polygon`, `polygons`, `polyline`, `parentId`, `rank`, `isHidden`, `visibilityRange`, `labelVisibility`, `iconGlyph`/`iconColor`/`iconShape`/`iconSize`, `color`, `fillOpacity`, `fillStyle`, `borderStyle`, `strokeWidth`/`strokeStyle`/`strokeOpacity`, `labelSize`, `textColor`, `textEffect`/`textEffectColor`). The exception is `link` (linktext) instead of `uri`.
- Serialization is deterministic: 2-space indent, a fixed key order, features sorted by `(parentId, rank, id)`, and a trailing newline. That gives clean git diffs and reliable edits by Claude.
- Validation uses `zod`. An invalid file opens an error view showing the zod issues and is never overwritten.
- `version` and `migrate()` exist from day one, even with only one version.

*Alternatives:* `.map.json` (gets picked up by other JSON tooling and plugins, and Obsidian cannot register multi-dot extensions cleanly); frontmatter or markdown (excluded by the user's constraint). The extension lives in one constant in case of a clash with JavaScript source maps (see Risks).

### D3. Coordinate frame identical to LegendKeeper's

`z = max(0, ceil(log2(max(w, h) / 256)))`, `pos = [-y / 2^z, x / 2^z]`, bounds `[[-h / 2^z, 0], [0, w / 2^z]]`. The image is a Leaflet `imageOverlay` on those bounds in `CRS.Simple`. Native zoom equals `z`. `minZoom` is computed so the whole image fits, and `maxZoom` is `z + 2`. The feature `visibilityRange` `[a, b]` (0–1) maps linearly onto `[minZoom, maxZoom]`.

*Alternative:* raw pixel coordinates. Rejected because the LegendKeeper frame keeps zoom levels meaningful, and a later tile pyramid fits it with no data change.

### D4. View: `TextFileView` subclass registered for `.map`

`registerExtensions(['map'], VIEW_TYPE)` and `registerView`. `TextFileView` provides `setViewData` / `getViewData`, debounced `requestSave()`, and reloading on external modification. That reload is how edits by Claude or git appear live. Each edit applies to an in-memory model, then `requestSave()`. Parse errors switch the view into the error state.

*Alternative:* `FileView` with manual reads and writes. Rejected because `TextFileView` already handles the save and reload cycle and conflicts.

### D5. Rendering: Leaflet 1.9.x + Geoman (free) for geometry editing

Leaflet's CSS and Geoman's CSS are bundled into `styles.css`, because Obsidian only loads that file. Pins are `L.marker` with a `divIcon` that renders the shape plus a Lucide/Obsidian icon via `setIcon`. That avoids bundling FontAwesome, though the glyph name is still stored verbatim. Labels are `divIcon`s with text. Regions are `L.polygon`, paths are `L.polyline`. Every feature layer is rebuilt from the model by one `render(model, visibleState)` call that reuses layers by id. There is no separate source of truth in Leaflet.

*Alternatives:* a custom renderer (Zoom Map's cost); Leaflet.draw (unmaintained).

**Smooth zoom:** Leaflet's stock wheel handler debounces wheel events and then plays one animated zoom per batch, which feels like stepping between levels next to LegendKeeper. v1 sets `zoomSnap: 0` and replaces `scrollWheelZoom` with a small custom handler in `src/ui/`:
- **Per event:** each `wheel` event changes a target zoom by `-deltaY × k`, with `deltaMode` normalised so pixel, line and page deltas behave alike. A `ctrlKey` wheel (trackpad pinch) uses a larger `k`.
- **Clamp and anchor:** the target is clamped to `[minZoom, maxZoom]`, kept anchored on the pointer.
- **Easing:** one `requestAnimationFrame` loop eases the current zoom toward the target with `map.setZoomAround(..., { animate: false })`.

The handler listens on the map container and takes `requestAnimationFrame` from the container's own window, so it works in pop-outs. Double-click and the zoom buttons keep Leaflet's animated whole-step zoom. Features are rendered with vector or `divIcon` layers, so fractional zoom needs nothing extra from them.

*Alternative:* Leaflet.SmoothWheelZoom. Rejected because it is unmaintained and patches globals; the handler is about 100 lines.

**Icon note:** LegendKeeper uses FontAwesome names. v1 uses Obsidian's bundled Lucide icons. `iconGlyph` stores the Lucide name, and an unknown name falls back to a dot.

### D6. Pop-out windows and sizing

All Leaflet containers are created in the view's `containerEl.ownerDocument`. Leaflet's `Draggable` binds `mousemove`/`mouseup` (and touch events) to the global `document`. A small, isolated `popoutShim` re-points those bindings to the owning document, and is checked by a pop-out acceptance test. A `ResizeObserver` on the container calls `map.invalidateSize()`, as does `onResize()` and workspace `layout-change`. The first `fitBounds` or viewport is deferred until the container has a non-zero size.

### D7. Links: linktext, resolved like wikilinks, plus a rename rewrite and a broken scan

- `link` holds Obsidian linktext (no brackets, optional `#heading`). It resolves through `metadataCache.getFirstLinkpathDest(linktext, mapPath)`, so moves into other folders resolve as long as the file name is unique.
- **Rename listener:** a `VaultMapIndex` caches every `.map` file's linked paths (built on layout ready, updated on map modify, create and delete). On `vault.on('rename', file, oldPath)`, each map that resolved a link to `oldPath` is rewritten with `metadataCache.fileToLinktext(file, mapPath)` through `vault.process` (atomic). The same listener rewrites `image.path`.
- **Broken detection:** a link is broken when the resolver returns null. A broken pin renders with a warning badge and its popup offers "Relink…" (a fuzzy note picker). The **Find broken pins** command scans every map and lists the broken pins, grouped by map, in a modal with Relink / Open map actions.
- Folder renames trigger a `rename` event for each child file, which the same listener handles.

*Alternative:* storing paths. Rejected because linktext matches how Obsidian links behave and survives moves even without the listener.

### D8. Drill-down through a user-named property

A setting `mapsProperty` (default `maps`) names a frontmatter list of links to `.map` files. When a pin's linked note has that property with at least one map, the pin shows a "has map" indicator, and its popup and context menu list "Open map: <name>" entries. A plain click opens the note, respecting Obsidian's modifier keys for a new tab or split. The property is read through `metadataCache.getFileCache(file).frontmatterLinks` or `.frontmatter`.

### D9. Style resolution

`resolveStyle(feature, note?) = defaults ⊕ feature.style ⊕ overrides(note)`. Overrides apply only when the user has enabled them **and** named a property (`iconProperty`, `colorProperty`, optionally `shapeProperty`), **and** the linked note has a valid value. Invalid values (such as a bad hex colour) are ignored. Overrides are never written back to the `.map` file. The view re-resolves styles on `metadataCache.on('changed')` for linked notes.

### D10. Editing UX

A toolbar in the view header offers Select, Pin, Label, Region, Path, Lock and Fit. A feature panel, a right sidebar inside the view, shows the folder tree (drag to reparent or reorder, eye toggle to hide) and the selected feature's properties form. Shift-click or right-click on the map gives "Add pin here". Delete key or context menu removes features. Deleting a folder asks before cascading. The lock disables every mutation path, enforced in the model layer and not only in the UI. Lock state is per view and not saved (default unlocked).

### D11. Testing strategy for loops

- `npm run check` = `tsc --noEmit && eslint && vitest run && node esbuild.config.mjs production`. Every bead must leave it green.
- `core/` has unit tests for 100% of exported functions. The adapters get thin tests against a hand-written `obsidian` mock (`test/mocks/obsidian.ts`) aliased in vitest.
- UI beads carry a **manual acceptance checklist** run against `test-vault/`, which holds a fixture 4096×3072 image and an 8192×6144 image, and `.map` fixtures including an invalid one and one with broken links. `npm run dev` builds into `test-vault/.obsidian/plugins/mythical-maps/` so the vault is ready to open.
- An end-to-end harness (`wdio-obsidian-service`) is a later follow-up, not v1.

## Risks / Trade-offs

- [`.map` collides with JavaScript source-map files in vaults that hold code] → the extension is a single constant; parsing requires `"type": "mythical-map"`, and files without it open as "not a Mythical map" without being touched. Revisit before the first release (Open Question 1).
- [Leaflet pop-out drag breakage] → an isolated `popoutShim` with its own bead and acceptance test, done early (spike), so the rest of the UI isn't built on a broken base.
- [8k image memory, about 256 MB decoded] → acceptable on desktop. Measure in the 8k fixture bead; tiling is a follow-up and the coordinate frame already supports it.
  **Performance check (bead 8.1, manual).** Fixture: `test-vault/Maps/perf-8k-200pins.map` (8192×6144 image, 200 pins in 8 folders plus top level, mixed styles; regenerate with `npm run fixtures:perf`, images with `npm run fixtures`). Procedure, on desktop Obsidian with `npm run dev` running:
  1. Restart Obsidian with only the test vault open and no other maps open. Open dev tools (Cmd+Opt+I / Ctrl+Shift+I) and, in Console, run `window.__MM_PERF__ = true` so render timings are logged (`[mythical-maps] render: N features in X ms`).
  2. Memory tab, Heap snapshot (or Performance monitor's JS heap size): record **baseline** with the vault loaded and no map open. Click the trash icon (collect garbage) first.
  3. Open `perf-8k-200pins.map`. Note the logged render time. Take a heap snapshot (collect garbage first) and record **after open**.
  4. Performance tab: Record while you pan across the whole image for about 10 s, zoom in and out with the wheel and trackpad pinch from fully fit to max zoom, then stop. Note whether the frame rate holds near 60 fps and any long frames. Record **after interaction** heap size (collect garbage first).
  5. Close the map tab, collect garbage, record **after close** (a large remainder suggests a leak).

  | Measure | Result |
  | --- | --- |
  | Machine / OS / Obsidian version | Not recorded (skipped) |
  | Baseline heap (MB) | 30.9 |
  | Heap after open (MB) | 42 |
  | Heap after pan/zoom (MB) | Not measured (skipped) |
  | Heap after close (MB) | Not measured (skipped) |
  | Render time, 200 pins (ms) | 59.2 (188 features drawn; the rest are hidden by `visibilityRange` at fit zoom) |
  | Pan feels smooth (yes/no, fps) | Not recorded (skipped) |
  | Zoom feels smooth (yes/no, fps) | Not recorded (skipped) |
  | Notes | Partial check by the maintainer: open cost is about 11 MB for the 8k image plus 200 pins, with no problem found. The interaction and leak measurements were skipped, so no tiling bead was filed. |

  Rule: any problem (dropped frames, stutter, heap well above about 400 MB, memory not released on close) becomes a follow-up bead for tiling (the image pyramid the coordinate frame already supports), not a fix inside 8.1.
- [Renames outside Obsidian break links silently] → broken links are always visible (badge plus command) and never deleted; Relink repairs them.
- [Duplicate note names make linktext ambiguous] → resolve like Obsidian does (nearest/first). On rename, `fileToLinktext` emits a disambiguating path when needed.
- [Concurrent edits: the same map open in two panes, or Claude editing while the view has unsaved changes] → `TextFileView`'s reload semantics, plus all writes from the rename listener go through `vault.process`. Last write wins, which is acceptable for v1.
- [Geoman bundle size and CSS clashes with Obsidian themes] → scope all CSS under `.mythical-map-view`, and check the bundle size in the scaffold bead.
- [Lucide instead of FontAwesome diverges from LegendKeeper] → acceptable, since LegendKeeper is a reference only; the glyph name is stored as a string.

## Migration Plan

Greenfield, so no migration. `schema.version = 1` with a `migrate()` stub establishes the upgrade path for future formats.

## Open Questions

1. Is the final file extension `.map`, or something more distinctive (for example `.mmap`)? This is decided by a constant before release.
2. Should "Open map" from a pin replace the current tab or open a new one by default? The proposal is to replace, with modifiers for a new tab or split.
3. Does Obsidian's `setIcon` (Lucide) cover enough TTRPG glyphs, or is a custom SVG icon set needed later?
