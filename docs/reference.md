# Mythical Maps reference

Details of features, settings, the file format and known limits. New to the plugin? Start with the [README](../README.md).

## Features in detail

- **Create a map.** Run **New map from image** from the command palette with an image file active, or right-click an image in the file explorer. It creates `<image name>.map` next to the image (`<name> 1.map`, `<name> 2.map` and so on if the name is taken), sized to the image, and opens it. Supported images: png, jpg, jpeg, webp, gif, bmp, avif, svg.
- **Navigate.** Mouse wheel and trackpad pinch zoom continuously around the pointer; drag pans; double-click and the zoom buttons zoom in animated steps. Zoom runs from the level that fits the whole image up to native zoom `z + 2`. The **Fit map to view** toolbar button refits.
- **Edit.** The toolbar has Select, Pin, Label, Region and Path modes. Pin and Label click a position. Region and Path draw vertices: a region needs at least 3 and a path at least 2, otherwise nothing is created. Shift-click, or the map context menu, adds a pin at that spot in any mode. New features go into the selected folder (or the root) as the last sibling. In Select mode, drag pins and labels, and drag, add or remove vertices of regions and paths. The feature panel (a tab in the right sidebar that follows the map you used last) shows the folder tree (drag to reorder or reparent, eye toggle to hide) and the selected feature's properties: name, link, style fields, label visibility, hidden flag and visibility range. The Icon field suggests icons as you type, and each colour field has a colour picker. The panel is added the first time you open a map; if you close it, the map tab's panel button or **Show map panel** brings it back. Delete or Backspace removes the selection; deleting a folder with descendants asks first.
- **Lock.** The lock action in the view header (or **Toggle map lock**) refuses every create, edit, move, reshape, reorder and delete, enforced in the document model rather than only in the UI. Pan, zoom, hover and following links keep working. Lock state belongs to the open view: it is never saved in the file and each view starts unlocked.
- **Undo and redo.** Mod+Z and Mod+Shift+Z while the map view is active (not while a text field has focus), or the **Undo map edit** and **Redo map edit** commands. History is per open view, up to 200 steps, and is cleared when the file is reloaded from disk or another file is opened.
- **Saving.** A map is written only after you edit it. Edits are saved to the `.map` file through Obsidian's debounced save, in canonical form, and are flushed when the tab closes, the file is switched or Obsidian quits. A file that failed to parse or validate is never written to.
- **Live reload.** If the open file changes on disk (Claude, git, sync) and the view has no unsaved edits, the map re-renders in place and keeps its pan and zoom. With unsaved edits the local version is kept, a notice says the file changed, and the pending save wins (last write wins).

### Commands

| Command | Notes |
| --- | --- |
| New map from image | Available when the active file is an image; also on the file-menu of image files |
| Set current view as default | Saves the current centre and zoom as `viewport`; active map view only |
| Undo map edit / Redo map edit | Active map view with something to undo or redo |
| Toggle map lock | Active map view |
| Find broken pins | Scans every `.map` file in the vault and lists pins whose link does not resolve, grouped by map, with **Open map** (centres on and selects the pin) and **Relink…**. Shows "No broken pins" when clean |

### Links and the maps property

A pin's `link` is Obsidian linktext (no brackets, optionally `Note#Heading`), resolved the way a wikilink in the map file would be, so moving a note to another folder keeps the link working as long as the note name is unique. The feature panel has a fuzzy note picker that stores the shortest unambiguous linktext; choosing a note for a pin that is unnamed (blank or "New pin") also names the pin after it.

- **Hover and click.** Hovering a linked pin triggers Obsidian's page preview (when the Page Preview core plugin is on). Clicking opens the note, honouring Obsidian's modifier keys for a new tab or split. In an edit mode, a click selects the pin instead.
- **Drill-down.** If a pin's linked note has a frontmatter list under the maps property (default `maps`) with links to `.map` files, the pin shows a "has map" indicator and its popup and context menu list **Open map: <name>** for each entry that resolves. Entries that don't resolve to a `.map` file are ignored silently. Example frontmatter: `maps: ["[[Westmarch.map]]", "[[Westmarch Sewers.map]]"]` (an alias after `|` is used as the displayed name).
- **Rename listener.** When a note, image or folder is renamed or moved inside Obsidian, every `.map` file that linked to it is rewritten atomically (`vault.process`): each affected pin `link` becomes the new shortest linktext and a matching `image.path` is updated. Nothing else in those files changes.
- **Broken links.** A link that does not resolve (for example the note was renamed outside Obsidian) is shown with a broken-link badge and a **Relink…** action in the pin's popup. The plugin never clears or deletes a link because it does not resolve. Use **Find broken pins** to review the whole vault.

Map links are not part of Obsidian's backlinks or graph.

### Style overrides

Off by default. When **Enable frontmatter style overrides** is on and a property name is configured, a linked pin takes its icon, colour or shape from the linked note's frontmatter instead of its stored style, for example a faction colour from `faction-color: "#AA2233"`. Only valid values count (`#RRGGBB` for colour, a known shape name, a non-empty icon name); anything invalid falls back to the pin's stored style. A one-element list is read as its single value. Overrides apply to linked pins only, never change the `.map` file, and update live when the note's frontmatter changes.

Each style field resolves in this order: valid frontmatter override, the feature's stored style, the plugin default for that feature type.

## Settings

Settings are stored in the plugin's `data.json` and contain no map data. Invalid stored values fall back to the default.

| Setting | Default | Notes |
| --- | --- | --- |
| Maps property | `maps` | Frontmatter property listing a note's `.map` files (drill-down). Cannot be empty |
| Enable frontmatter style overrides | off | Master switch for the three properties below |
| Icon property | empty (disabled) | Frontmatter property read as a Lucide icon name |
| Colour property | empty (disabled) | Frontmatter property read as `#RRGGBB` |
| Shape property | empty (disabled) | Frontmatter property read as a pin shape |
| Default pin glyph | `map-pin` | Lucide icon name used when a pin stores none |
| Default pin colour | `#A7A7A7` | `#RRGGBB` |
| Default pin shape | `pin` | One of `pin`, `diamond`, `flag`, `marker`, `shield`, `circle`, `banner`, `arch`, `none` |
| Default pin size | `medium` | `medium` or `small` |

Defaults for other feature types are fixed (no settings): labels are `md`, `#FFFFFF` with a `#000000` outline; regions `#3B82F6`, fill opacity 0.3, solid fill and border; paths `#3B82F6`, width 3, solid, opacity 1.

## The `.map` file format

A `.map` file is pretty-printed JSON (2-space indent, trailing newline). The plugin always writes it in one canonical form: fixed key order, features sorted by `parentId`, then `rank`, then `id`, and coordinate pairs on one line. Loading a canonical file and saving it with no edits changes nothing, which keeps git diffs clean and makes the file safe for Claude or scripts to edit. Unknown keys are rejected, and a file that fails validation is shown with every issue and its JSON path and is never overwritten.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `type` | Must be `"mythical-map"`. A file without it is reported as "not a Mythical map" and left untouched |
| `version` | Integer, currently `1`. Older versions go through `migrate()`; a newer version is refused with an "upgrade the plugin" message |
| `image` | `{ "path", "width", "height" }`: vault-relative image path and its pixel size |
| `viewport` | Optional `{ "center": [lat, lng], "zoom" }` opening view. Without it the map opens fitted |
| `features` | Flat array of features; hierarchy is expressed through `parentId` |

Every feature has `id` (8 characters matching `^[a-z][0-9a-z]{7}$`; 24-character cuid2 ids are also accepted), `type`, `rank` (a fractional-index string that orders siblings), and optionally `name`, `parentId` (must name a `folder`), `isHidden`, `visibilityRange` (`[min, max]` within 0 to 1, mapped linearly onto the map's min to max zoom) and `labelVisibility` (`always`, `hover` or `never`). Field names follow LegendKeeper's Feature schema, except `link` (Obsidian linktext) in place of `uri`.

| Type | Geometry and extra fields | `style` fields |
| --- | --- | --- |
| `pin` | `pos: [lat, lng]`, optional `link` | `iconGlyph` (Lucide name), `iconColor`, `iconShape`, `iconSize` |
| `label` | `pos` | `labelSize`, `textColor`, `textEffect`, `textEffectColor` |
| `region` | `polygon` (3 or more vertices) or `polygons` | `color`, `fillOpacity`, `fillStyle`, `borderStyle`, plus the text fields |
| `path` | `polyline` (2 or more vertices) | `color`, `strokeWidth`, `strokeStyle`, `strokeOpacity`, plus the text fields |
| `folder` | none; groups children and can be hidden | none |

Colours are `#RRGGBB`. A hidden folder hides every descendant. An unknown `iconGlyph` renders as a dot.

Example (from `test-vault/Maps/all-types.map`, trimmed):

```json
{
  "type": "mythical-map",
  "version": 1,
  "image": { "path": "Maps/fixture-4k.png", "width": 4096, "height": 3072 },
  "viewport": { "center": [-96, 128], "zoom": 2 },
  "features": [
    { "id": "ftowns01", "type": "folder", "name": "Towns", "rank": "a0", "isHidden": false },
    { "id": "pwestm01", "type": "pin", "name": "Westmarch", "rank": "a1",
      "pos": [-96, 128], "link": "Westmarch",
      "style": { "iconGlyph": "castle", "iconColor": "#3366CC", "iconShape": "pin", "iconSize": "medium" } },
    { "id": "rdarkf01", "type": "region", "name": "Dark Forest", "rank": "a3",
      "polygon": [[-32, 160], [-32, 224], [-96, 224], [-96, 160]],
      "style": { "color": "#2E7D32", "fillOpacity": 0.35, "borderStyle": "solid" } },
    { "id": "prusty01", "type": "pin", "name": "Rusty Flagon", "parentId": "ftowns01", "rank": "a0",
      "pos": [-64, 96], "link": "Rusty Flagon" }
  ]
}
```

(The hand-written fixtures use compact one-line features; the plugin rewrites them in canonical form the first time it saves an edit.)

## Coordinate frame

The frame is identical to LegendKeeper's, using Leaflet's `CRS.Simple`. For an image of `w` by `h` pixels:

- native zoom `z = max(0, ceil(log2(max(w, h) / 256)))`
- image pixel `(x, y)`, measured from the top-left, maps to `pos = [-y / 2^z, x / 2^z]` (`[lat, lng]`: latitude is negative downwards, so Y points up)
- the image covers bounds `[[-h / 2^z, 0], [0, w / 2^z]]`

For example, an 8192 by 6144 image has `z = 5`, and its bottom-right pixel `(8192, 6144)` is `pos = [-192, 256]`. A 4096 by 3072 image has `z = 4` and the same bounds. Zoom runs from the fit-to-view level up to `z + 2`, and zoom is continuous (`zoomSnap: 0`), so `viewport.zoom` can be fractional. The conversion functions (`pixelToPos`, `posToPixel`) are exact inverses; see `src/core/frame.ts`.

The map is a single `imageOverlay` (no tiling). A later tile pyramid would fit the same frame with no data change.

## Known limits

- **No tiling.** The whole image is decoded in memory. Images up to about 8k pixels are the target. A partial check on an 8192 by 6144 image with 200 pins showed about 11 MB heap growth on open, with no problem found; pan, zoom and leak measurements were not taken (see the [design notes](../openspec/changes/archive/2026-11-26-add-map-core-v1/design.md), Risks).
- **Mobile is untested.** The manifest allows mobile (`isDesktopOnly: false`) but nothing is verified there; touch drawing and editing are best effort.
- **Pop-out windows.** Pan, zoom and dragging work through a Leaflet shim. Geoman's optional keyboard shortcuts (Esc, Enter) do not work in pop-outs: finish a shape by clicking its first or last vertex, and switch mode to cancel.
- **Icons are Lucide, not FontAwesome.** `iconGlyph` stores a Lucide icon name from Obsidian's bundled set; an unknown name falls back to a dot. LegendKeeper's FontAwesome names will not match.
- **One base image per map.** No overlays, fog of war, distance measurement, scale, grids or free drawing.
- **No embeds.** `![[X.map]]` in a note is not supported.
- **Not in backlinks or the graph.** Pin links are stored in the `.map` file, not in a note.
- **Renames outside Obsidian** (Claude, git, a file manager) are not rewritten; affected pins show the broken-link badge and keep their link until you relink them. The "Find broken pins" list shows each pin's link text, not the pin's name.
- **Concurrent edits.** If the same map is open in two panes or edited externally while the view has unsaved changes, the last write wins.
- **Undo history** is per open view, capped at 200 steps, and cleared by an external reload.
- **Extension.** The `.map` extension can clash with JavaScript source-map files in vaults that contain code. Such files open as "not a Mythical map" and are never modified. See the [design notes](../openspec/changes/archive/2026-11-26-add-map-core-v1/design.md), Open Question 1.
