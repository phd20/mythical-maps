<!--
Bead conventions (for loop + beads implementation)
- Each `X.Y` task is exactly one bead. Bead title = "X.Y <task title>".
- `Depends:` lists the beads that must be closed first (use `bd dep add`). A bead is ready when all its dependencies are closed.
- `Accept:` lists the acceptance criteria. Every bead ALSO requires `npm run check` (tsc + eslint + vitest + production build) to pass, from 1.1 onward.
- `Verify: auto` means automated tests cover the acceptance criteria, and a loop may close the bead itself.
- `Verify: manual` means a human must run the listed checklist in `test-vault/`. A loop finishes the code, then labels the bead `needs-human-verify` and moves on; it never closes the bead itself.
- When a bead closes, tick its checkbox here.
-->

## 1. Project setup

- [x] 1.1 Scaffold the Obsidian plugin project
  - Depends: none
  - Accept: `package.json`, `tsconfig.json` (strict), `esbuild.config.mjs`, `manifest.json` (id `mythical-maps`, `isDesktopOnly: false`), eslint config, and vitest with `obsidian` aliased to `test/mocks/obsidian.ts`; `src/main.ts` loads and unloads cleanly; `npm run check` and `npm run dev` exist; a trivial test passes
  - Verify: auto
- [ ] 1.2 Create the test vault and fixtures
  - Depends: 1.1
  - Accept: `test-vault/` with `npm run dev` building into `.obsidian/plugins/mythical-maps/`; a script generates 4096×3072 and 8192×6144 fixture images; fixture `.map` files (valid with all five feature types, invalid JSON, missing type marker, future version, broken links, missing image); notes including one with a `maps:` list
  - Verify: auto (the script runs and the fixtures exist), plus a manual check that the plugin enables with no console errors

## 2. Core model (pure TypeScript, no obsidian or leaflet imports)

- [x] 2.1 Coordinate frame (`core/frame.ts`)
  - Depends: 1.1
  - Accept: `zoomFor(w, h)`, `boundsFor(w, h)`, `pixelToPos` and `posToPixel` match the formulas in design D3; tests cover the 8192×6144 corner (`[-192, 256]`, z = 5), images smaller than 256 px (z = 0), and round-trip inverses to within 1e-9
  - Verify: auto
- [x] 2.2 Map schema v1 (`core/schema.ts`)
  - Depends: 1.1
  - Accept: a zod schema and exported types for the map document and all five feature types; cross-field checks for required geometry per type, `parentId` naming an existing folder, duplicate ids, and `visibilityRange` with 0 ≤ min ≤ max ≤ 1; errors carry JSON paths; tests cover each map-file spec scenario
  - Verify: auto
- [ ] 2.3 Parse and migrate (`core/parse.ts`)
  - Depends: 2.2
  - Accept: `parseMap(text)` returns `{ok, map}` or `{ok: false, kind: 'json' | 'not-mythical' | 'future-version' | 'invalid', issues}`; `migrate()` is a v1 pass-through; tests cover each failure kind
  - Verify: auto
- [ ] 2.4 Deterministic serialization (`core/serialize.ts`)
  - Depends: 2.2
  - Accept: `stringifyMap` uses a fixed key order, 2-space indent, sorting by `(parentId, rank, id)` and a trailing newline; property test: `stringify(parse(stringify(m))) === stringify(m)` for generated maps
  - Verify: auto
- [x] 2.5 Ids and ranks (`core/ids.ts`)
  - Depends: 1.1
  - Accept: `newId(existing)` matches `^[a-z][0-9a-z]{7}$` and is unique; `rankBetween(a, b)` and `rankAfter(last)` use `fractional-indexing`; tests cover inserting between `a0` and `a1` and repeated inserts
  - Verify: auto
- [ ] 2.6 Feature tree operations (`core/features.ts`)
  - Depends: 2.2, 2.5
  - Accept: immutable `children`, `ancestors`, `effectiveHidden`, `visibleAtZoom(feature, zoom, minZoom, maxZoom)`, `insert`, `move` (refuses cycles), `update` and `deleteSubtree`; tests cover each map-editing tree scenario and the zoom-gating scenario
  - Verify: auto
- [ ] 2.7 Map document store with lock and undo (`core/document.ts`)
  - Depends: 2.6
  - Accept: a `MapDocument` with `apply(op)`, `subscribe`, `lock`/`unlock` (when locked, every mutating op is refused and returns an error), and `undo`/`redo`; tests cover the locked-drag refusal, undoing a delete (restores the same id), and redo
  - Verify: auto
- [ ] 2.8 Link logic (`core/links.ts`)
  - Depends: 2.2
  - Accept: given an injected `LinkResolver`, provides `collectLinks(map, mapPath)`, `findBroken(map, mapPath)`, and `rewriteForRename(map, mapPath, oldPath, newLinktextFn)`, which changes only the `link` and `image.path` fields; tests cover the note rename, image move, folder rename and "broken stays untouched" scenarios
  - Verify: auto
- [x] 2.9 Style resolution (`core/style.ts`)
  - Depends: 2.2
  - Accept: `resolveStyle(feature, defaults, overrideConfig, frontmatter?)` follows the order in design D9; rejects invalid values; tests cover each plugin-settings scenario
  - Verify: auto

## 3. Obsidian integration basics

- [ ] 3.1 Settings and settings tab
  - Depends: 1.1, 2.9
  - Accept: a typed settings object with the defaults from the plugin-settings spec; load and save through `data.json`; the settings tab edits every field; a unit test for merging defaults on load
  - Verify: auto (defaults and merge), plus a manual check that the settings tab renders and saves
- [ ] 3.2 Map file view (no Leaflet yet)
  - Depends: 2.3, 2.4
  - Accept: `.map` registered with a `TextFileView`; valid files show a placeholder summary (feature counts); invalid, not-mythical and future-version files show the error states; saving is impossible from an error state; adapter test with the mock confirms `getViewData` returns canonical JSON and no write happens when invalid
  - Verify: auto, plus a manual check that the fixture files show the right states
- [ ] 3.3 "New map from image" command
  - Depends: 3.2, 2.1
  - Accept: a command and file-menu item on images; reads the pixel size; creates `<basename>.map` next to the image, with a numeric suffix when the name is taken; opens it; adapter test covers the naming and the generated document
  - Verify: auto, plus a manual check on the 8k fixture

## 4. Map rendering

- [ ] 4.1 SPIKE: Leaflet base map, sizing and pop-out shim
  - Depends: 3.2, 2.1, 1.2
  - Accept: Leaflet and its CSS bundled into `styles.css`, scoped under `.mythical-map-view`; the image is shown as an `imageOverlay` on the frame bounds in `CRS.Simple`; a `ResizeObserver` plus `onResize` calls `invalidateSize`; the initial fit waits for a non-zero size; `popoutShim` makes drag work in pop-out windows
  - Verify: manual: (a) open a map in a background tab, then switch to it: it fits correctly; (b) resize the split: no grey areas; (c) move to a pop-out window: panning by drag works and ends on release
- [ ] 4.2 Viewport, zoom limits and missing image
  - Depends: 4.1
  - Accept: opens at `viewport` or fits the image; zoom limits from fit to `z + 2`; "Set current view as default" saves `viewport`; a missing image shows the notice with "Choose image…", which updates `image` (path, width, height)
  - Verify: manual, using the viewport and missing-image fixtures
- [ ] 4.3 Feature renderer
  - Depends: 4.1, 2.9
  - Accept: one `render(model, view)` call reuses Leaflet layers by feature id; pins drawn as a shape plus `setIcon` glyph with colour and size; labels; regions with fill and border styles; paths with stroke styles; `labelVisibility` respected; unknown glyphs fall back to a dot
  - Verify: manual: the all-types fixture renders every feature at its coordinates with its style
- [ ] 4.4 Visibility: folders and zoom ranges
  - Depends: 4.3, 2.6
  - Accept: features hidden by `effectiveHidden` or outside `visibilityRange` are not drawn; visibility re-evaluates on `zoomend`
  - Verify: manual: the hidden-folder and zoom-gated label scenarios
- [ ] 4.5 Live reload on external change
  - Depends: 4.3
  - Accept: an external modification of an open, unmodified map re-renders it while keeping pan and zoom
  - Verify: manual: edit the fixture `.map` in a text editor while it's open, and the new pin appears

## 5. Editing

- [ ] 5.1 Wire the document store to the view: saving, lock and undo
  - Depends: 2.7, 4.3
  - Accept: every edit goes through `MapDocument` then `requestSave()`; edits are flushed on close and unload; lock toggle in the view header; Mod+Z and Mod+Shift+Z scoped to the focused map view
  - Verify: manual: the close-right-after-edit, locked-drag and undo-delete scenarios
- [ ] 5.2 Toolbar modes and creating pins and labels
  - Depends: 5.1
  - Accept: Select, Pin, Label, Region and Path modes plus Fit; clicking in Pin or Label mode creates the feature; Shift-click and context menu "Add pin here"; new features go into the selected folder as its last child, and are selected
  - Verify: manual: the add-pin scenario
- [ ] 5.3 Geometry: draw regions and paths, drag and reshape
  - Depends: 5.2
  - Accept: Geoman (free) bundled and scoped; drawing a region or path creates the feature; too few vertices creates nothing; in Select mode, pins and labels can be dragged and vertices moved, added or removed, all saved through `MapDocument`
  - Verify: manual: the draw-region, too-few-vertices and drag-pin scenarios, also tried once in a pop-out window
- [ ] 5.4 Feature panel tree
  - Depends: 5.1, 4.4
  - Accept: an in-view side panel shows the tree ordered by `rank`; selection syncs between the panel and the map; eye toggle; create and rename folders; drag to reorder or reparent, with cycles refused
  - Verify: manual: the move-into-folder and no-cycles scenarios
- [ ] 5.5 Properties form
  - Depends: 5.4
  - Accept: per-type fields (name, style fields, `labelVisibility`, `isHidden`, `visibilityRange`); invalid input shows an error and keeps the stored value; changes apply live
  - Verify: manual: the rename-pin and invalid-colour scenarios
- [ ] 5.6 Delete features
  - Depends: 5.4
  - Accept: Delete key and context menu; deleting a folder with descendants asks for confirmation, then cascades; cancelling removes nothing
  - Verify: manual: the delete-folder and cancel scenarios

## 6. Note links

- [ ] 6.1 Link picker
  - Depends: 5.5
  - Accept: a fuzzy note picker in the pin form sets `link` via `fileToLinktext` (shortest unambiguous); the link can be cleared
  - Verify: manual: the set-link-with-picker scenario
- [ ] 6.2 Hover preview and opening notes
  - Depends: 4.3
  - Accept: hovering a linked pin triggers the `hover-link` page preview; clicking opens the note with Obsidian's modifier semantics; in edit modes a click selects instead
  - Verify: manual: the hover and Mod-click scenarios
- [ ] 6.3 Drill-down into a note's maps
  - Depends: 6.2, 3.1
  - Accept: reads the configured maps property from the linked note; shows a "has map" indicator; popup and context menu list "Open map: <name>" for each entry that resolves; unresolved entries are ignored
  - Verify: manual: the drill-into-city-map scenario, also after renaming the property in settings
- [ ] 6.4 Vault map index
  - Depends: 2.8, 2.3
  - Accept: `VaultMapIndex` built on layout ready from all `.map` files; updated on create, modify, delete and rename of `.map` files; exposes the maps referencing a path; adapter tests with the mock vault
  - Verify: auto
- [ ] 6.5 Rename listener
  - Depends: 6.4
  - Accept: on `vault.on('rename')`, every affected map is rewritten via `vault.process` using `rewriteForRename` (links and `image.path` only); adapter tests cover the note rename, image move and folder rename scenarios
  - Verify: auto, plus a manual note rename in the test vault
- [ ] 6.6 Broken-link badge and Relink
  - Depends: 6.1, 4.3
  - Accept: unresolved pins drawn with a badge; popup "Relink…" opens the picker and saves; `link` is never cleared automatically
  - Verify: manual: the renamed-outside-Obsidian and relink scenarios (rename a note in Finder)
- [ ] 6.7 "Find broken pins" command
  - Depends: 6.4, 6.6
  - Accept: scans every map through the index and the resolver; a modal groups broken pins by map with "Open map" (centred on the pin) and "Relink…"; shows "No broken pins" when there are none
  - Verify: auto (the scan function), plus a manual check of the modal

## 7. Frontmatter style overrides

- [ ] 7.1 Apply style overrides in the renderer
  - Depends: 4.3, 3.1, 2.9
  - Accept: the renderer resolves styles with the frontmatter of linked notes when overrides are enabled and configured; re-renders affected pins on `metadataCache.on('changed')`; never writes overrides to the file
  - Verify: manual: the colour-override, overrides-disabled and frontmatter-changes scenarios

## 8. Hardening and release readiness

- [ ] 8.1 Performance check with the 8k image
  - Depends: 4.3
  - Accept: the 8192×6144 fixture with about 200 pins pans and zooms smoothly on desktop; heap usage is recorded in `design.md` under Risks; any problem is filed as a follow-up bead (tiling)
  - Verify: manual
- [ ] 8.2 Full acceptance pass and README
  - Depends: 3.3, 4.2, 4.5, 5.3, 5.6, 6.3, 6.5, 6.7, 7.1
  - Accept: every scenario in `specs/` has been walked in `test-vault/` and ticked; README documents the `.map` format, the coordinate frame, the settings and the known limits; the extension decision (Open Question 1) is recorded
  - Verify: manual
- [ ] 8.3 Mobile smoke test (best effort)
  - Depends: 8.2
  - Accept: open, pan, zoom and tap a pin on iOS or Android; results noted in the README; failures become follow-up beads, not blockers
  - Verify: manual
