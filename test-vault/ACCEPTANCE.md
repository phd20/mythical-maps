# Acceptance checklist (task 8.2)

Walk every scenario of `openspec/changes/add-map-core-v1/specs/*/spec.md` in this vault and tick it. 65 scenarios: map-file 15, map-view 16, map-editing 15, note-links 12, plugin-settings 7.

## Setup

1. `npm install`, `npm run fixtures`, then `npm run dev` (leave it running). Open `test-vault/` in Obsidian and enable Mythical Maps. Settings are at their defaults unless a step says otherwise.
2. Work on **copies** of fixtures when a step edits or breaks things, so the committed fixtures stay clean: duplicate the file in the file explorer, and delete the copy afterwards. Steps below name these as "scratch". After renaming or moving notes, undo the change (or `git checkout test-vault`) before the next group.
3. Fixtures (see `test-vault/README.md`): `all-types.map` (4k image: folder Towns with pin Rusty Flagon, pin Westmarch, label with `visibilityRange [0.5, 1]`, region, path, hidden folder Secret Places with pin The Keep), `big-8k.map` (8k image, pins at known pixels), `perf-8k-200pins.map`, `invalid-json.map`, `not-mythical.map`, `future-version.map`, `broken-links.map`, `missing-image.map`, and notes `Places/Westmarch.md` (has `maps:`), `Places/Rusty Flagon.md`, `Places/The Keep.md` (has `faction-color`).
4. Scenarios marked **(tests)** are also covered by unit tests; tick them after a quick look at `npm run check` output (green) and, where it is cheap, the observable behaviour.

Record any failure under the scenario as a new bead; do not tick it.

## map-file

### Requirement: Map file is the single source of truth

- [ ] **Valid file loads.** WHEN a valid version-1 `.map` is parsed THEN a typed model with every feature intact. Fixture: open `all-types.map`; all 8 features exist (feature panel lists them, hidden folder included). **(tests)**
- [ ] **No markdown writes.** WHEN any edit is saved THEN only the `.map` file changes and no markdown file does. Fixture: `all-types.map` (scratch copy). Move a pin, wait for the save, then `git status test-vault` shows only the `.map` changed (no `.md`).

### Requirement: Feature model

- [ ] **Pin without position is rejected.** WHEN a pin has no `pos` THEN validation fails naming the feature id and `pos`. Fixture: scratch copy of `all-types.map`, delete `"pos"` from `pwestm01`; the error view names `pwestm01` and `pos`. **(tests)**
- [ ] **Parent must be a folder.** WHEN `parentId` names a non-folder or missing feature THEN validation fails naming the id and `parentId`. Fixture: scratch copy, set `prusty01`'s `parentId` to `pwestm01` (a pin), then to `nope0000`; both give an error naming `prusty01` and `parentId`. **(tests)**
- [ ] **Duplicate ids are rejected.** WHEN two features share an `id` THEN validation fails naming the id. Fixture: scratch copy, give `pkeep001` the id `pwestm01`; the error names `pwestm01`. **(tests)**

### Requirement: Invalid files are never overwritten

- [ ] **Invalid JSON.** WHEN the file is malformed JSON THEN an error with a position, and no save is possible until it parses. Fixture: `invalid-json.map`; the error view shows a position, the file on disk is unchanged after opening and closing it (`git status`). Fix the JSON in scratch copy and confirm it then loads.
- [ ] **Wrong type marker.** WHEN valid JSON lacks `"type": "mythical-map"` THEN "not a Mythical map" and the file is untouched. Fixture: `not-mythical.map`; message shown, `git status` clean.

### Requirement: Versioning and migration

- [ ] **Future version.** WHEN `version` is greater than supported THEN parsing fails with an upgrade message and the file is not modified. Fixture: `future-version.map` (version 99); upgrade message shown, file unchanged.

### Requirement: Deterministic serialization

- [ ] **Round trip is stable.** WHEN a map is serialized, parsed and serialized again THEN both strings are byte-identical. **(tests)** Fixture: `all-types.map` scratch copy; make an edit and undo it, save; reopening and saving again leaves the file byte-identical (`git diff` shows no change between the two saves).
- [ ] **Unchanged model does not produce a diff.** WHEN a map is loaded and saved with no edits THEN contents are unchanged if already canonical. Fixture: a map the plugin has already saved once (the scratch copy from the previous step); open it, wait, close it: `git diff` shows nothing new. (The hand-written fixtures are compact, not canonical, so they will be rewritten on their first real edit; opening alone must not write.)

### Requirement: LegendKeeper-compatible coordinate frame

- [ ] **Corner conversion.** WHEN the image is 8192x6144 and pixel (8192, 6144) is converted THEN z is 5 and pos is `[-192, 256]`. **(tests)** Fixture: `big-8k.map`; the pin named "South-east (7000, 5500)" at `[-171.875, 218.75]` sits at the matching pixel of the fixture image (grid every 256 px, thick line every 1024 px).
- [ ] **Inverse.** WHEN any pixel is converted to `pos` and back THEN it equals the original within 1e-9. **(tests)** (`npm run check` green.)

### Requirement: Stable ids and ordering

- [ ] **Insert between siblings.** WHEN a feature is inserted between ranks `a0` and `a1` THEN it gets a rank strictly between, and no other rank changes. **(tests)** Fixture: scratch copy of `all-types.map`; drag a pin between two siblings in the panel and check in the file that only the moved feature's `rank` changed and its id matches `^[a-z][0-9a-z]{7}$`.

### Requirement: New map from image

- [ ] **Create from image.** WHEN "New map from image" runs on an image THEN `<basename>.map` is created next to it with the correct path, size, empty `features`, and opens. Fixture: `Maps/fixture-8k.png`: file-menu on the image, then again via the command palette with the image active. Expect `Maps/fixture-8k.map` with width 8192, height 6144, `features: []`, opens fitted. (Delete the new file afterwards.)
- [ ] **Name taken.** WHEN `Maps/fixture-8k.map` already exists THEN the new file is `Maps/fixture-8k 1.map` and the existing file is untouched. Fixture: run it a second time on the same image; the first file is unchanged.

## map-view

### Requirement: Map files open in a map view

- [ ] **Open a map.** WHEN `.map` is opened from the file explorer THEN a tab shows the image fitted, with pan and zoom by wheel, drag and double-click. Fixture: `big-8k.map`.
- [ ] **Missing image.** WHEN `image.path` does not resolve THEN "Image not found: <path>" with a "Choose image…" action, and features still listed in the panel. Fixture: `missing-image.map` (scratch copy for the choose step): the notice and the panel entry "Pin on a missing image" appear; choosing `fixture-4k.png` loads the image.
- [ ] **Invalid file.** WHEN validation fails THEN the list of errors, no map, no write. Fixture: scratch copy of `all-types.map` with a pin missing `pos` (as above), or `invalid-json.map`; `git status` clean after viewing.

### Requirement: Opening viewport and zoom limits

- [ ] **Saved viewport.** WHEN a map with `viewport { center: [-96, 128], zoom: 3 }` opens THEN it is centred at `[-96, 128]` at zoom 3. Fixture: scratch copy of `all-types.map` with `"zoom": 3`; the view opens centred on the Westmarch pin region at that zoom.
- [ ] **Set opening view.** WHEN "Set current view as default" runs THEN centre and zoom are saved as `viewport`. Fixture: scratch copy of `all-types.map`: pan and zoom, run the command from the palette; the file's `viewport` matches (zoom may be fractional).

### Requirement: Smooth continuous zoom

- [ ] **Trackpad pinch.** WHEN pinching slowly over a point THEN the image scales smoothly with no jumps and the point under the pointer stays put. Fixture: `big-8k.map` (use a grid intersection as the anchor).
- [ ] **Mouse wheel.** WHEN scrolling several notches THEN a small change per notch, eased, not a whole level per notch. Fixture: `big-8k.map`.
- [ ] **Zoom limits.** WHEN zooming in or out without stopping THEN zoom stops smoothly at fit (min) and `z + 2` (max) without overshoot or bounce. Fixture: `big-8k.map` (max is zoom 7).
- [ ] **Pop-out window.** WHEN the map is in a pop-out THEN wheel and pinch zoom behave as in the main window. Fixture: `big-8k.map`: move the tab to a new window (right-click the tab, Move to new window) and repeat the three scenarios above.

### Requirement: Correct sizing

- [ ] **Opened in a background tab.** WHEN a map opens in a non-visible tab and you later switch to it THEN the image fills the view at the correct fit. Fixture: Ctrl/Cmd-click `big-8k.map` in the explorer (opens in background tab) while another tab is active, then switch.
- [ ] **Pane resize.** WHEN the pane is resized THEN the map redraws with no grey or blank areas. Fixture: `all-types.map`: toggle both sidebars, drag a split divider, split the pane.

### Requirement: Pop-out window support

- [ ] **Drag in pop-out.** WHEN the map is in a pop-out and you drag the map then a pin THEN both drags follow the pointer and end on release. Fixture: `all-types.map` in a pop-out, unlocked, Select mode. Also try drawing a region and dragging a vertex there.

### Requirement: Feature rendering

- [ ] **All types render.** WHEN a map with one of each drawable type opens THEN each appears at its stored coordinates with its stored style. Fixture: `all-types.map` (visible: Westmarch castle pin in blue, Rusty Flagon beer pin, region Dark Forest in green, dashed brown path; the label "The Wild Coast" appears once zoomed in past the midpoint, see the zoom-gated scenario).

### Requirement: Visibility rules

- [ ] **Hidden folder hides descendants.** WHEN a folder's visibility is toggled off THEN every feature under it, at any depth, disappears, and reappears when toggled on. Fixture: `all-types.map`: toggle "Towns" off (Rusty Flagon disappears) and on; toggle "Secret Places" on (The Keep appears). For depth, create a folder inside Towns with a pin in it and toggle Towns.
- [ ] **Zoom-gated feature.** WHEN a label has `visibilityRange [0.5, 1]` and the map is at minimum zoom THEN it is hidden, appearing once zoom passes the midpoint. Fixture: `all-types.map`, label "The Wild Coast".

### Requirement: Live reload on external change

- [ ] **External edit.** WHEN an open map's file is modified externally to add a pin THEN the pin appears without reopening, keeping pan and zoom. Fixture: scratch copy of `all-types.map` open and clean (no unsaved edits); pan and zoom somewhere, then append a pin to the file with a text editor or `echo`/script outside Obsidian. Also confirm: with an unsaved edit pending, an external change shows the "changed on disk" notice instead.

## map-editing

Use a scratch copy of `all-types.map` for this section unless noted.

### Requirement: Create features

- [ ] **Add a pin.** WHEN Pin mode is picked and the map is clicked THEN a pin with a new id and default style is created at that position, selected, and saved. Also check Shift-click and the context menu's "Add pin here" in Select mode, and that a selected folder receives the new pin as its last child.
- [ ] **Draw a region.** WHEN Region mode is picked and at least three vertices are clicked and the shape finished THEN the region is created and saved.
- [ ] **Too few vertices.** WHEN a region is finished with fewer than three vertices or a path with fewer than two THEN no feature is created.

### Requirement: Select and edit properties

- [ ] **Rename a pin.** WHEN the selected pin's name is edited in the panel THEN the label updates on the map and the name is saved. Fixture: pin Westmarch.
- [ ] **Invalid colour input.** WHEN a colour that is not `#RRGGBB` is entered THEN the field shows an error and the stored colour is unchanged. Fixture: pin Westmarch's colour; check the file still has `#3366CC`.

### Requirement: Move and reshape features

- [ ] **Drag a pin.** WHEN a pin is dragged and released THEN its `pos` is updated and saved. Fixture: pin Rusty Flagon; also drag a label, and move, add and remove a vertex on the region and the path.

### Requirement: Delete features

- [ ] **Delete a folder with children.** WHEN a folder with two pins is deleted and confirmed THEN the folder and both pins are removed and saved. Fixture: add a second pin into "Towns" first, then delete Towns (Delete key or context menu).
- [ ] **Cancel folder delete.** WHEN the confirmation is cancelled THEN nothing is removed.

### Requirement: Folder tree management

- [ ] **Move into folder.** WHEN a pin is dragged onto the folder "Towns" THEN its `parentId` is the folder's id, it becomes the last child, and it is saved. Fixture: drag "Westmarch" onto "Towns".
- [ ] **No cycles.** WHEN a folder is dragged into one of its own descendants THEN the move is refused and the tree is unchanged. Fixture: create folder "Inner" inside "Towns", then drag "Towns" onto "Inner". Also create, rename, hide and delete a folder from the panel.

### Requirement: Reveal from the feature panel

- [ ] **Click a pin in the panel.** WHEN zoomed in elsewhere and a pin's row is clicked THEN it is selected, the map centres on it and the zoom is unchanged. Fixture: `all-types.map`; also try a region and a path row.
- [ ] **Click a folder in the panel.** WHEN a folder's row is clicked THEN it is selected and the view does not move. Fixture: "Towns" in `all-types.map`.

### Requirement: Lock toggle

- [ ] **Locked drag.** WHEN the view is locked and a pin is dragged THEN it does not move and the file is not modified. Fixture: lock via the header action, drag a pin, try to delete, rename, draw and drag in the panel (all refused with the lock notice); pan, zoom, hover and clicking a link still work. Reopen the tab: it is unlocked (lock is not saved).

### Requirement: Saving

- [ ] **Close right after edit.** WHEN a pin is moved and the tab is closed immediately THEN the new position is in the file. Fixture: move a pin and close the tab at once; reopen and check the file.

### Requirement: Undo within a session

- [ ] **Undo delete.** WHEN a pin is deleted and Mod+Z is pressed THEN it is restored with its original id and properties, and saved. Fixture: delete Rusty Flagon, Mod+Z; check the id `prusty01` and its link and style are back in the file. Also Mod+Shift+Z.

## note-links

### Requirement: Pins link to notes by linktext

- [ ] **Link resolves after a move.** WHEN a note is moved to another folder without renaming THEN the link still resolves. Fixture: in a scratch copy of the vault state, move `Places/Rusty Flagon.md` to a new folder; the Rusty Flagon pin in `all-types.map` still has no broken badge and its `link` is still `Rusty Flagon`. (Move it back afterwards.)
- [ ] **Set link with picker.** WHEN `Places/Westmarch.md` is picked in the link picker THEN `link` is the shortest unambiguous linktext, saved. Fixture: select a pin without a link (for example "North-west" in `big-8k.map`, scratch copy), pick Westmarch; the file shows `"link": "Westmarch"`.

### Requirement: Hover preview and open note

- [ ] **Hover.** WHEN a linked pin is hovered with Page Preview enabled THEN the note's preview appears. Fixture: pin Westmarch (Settings, Core plugins, Page preview on).
- [ ] **Mod-click.** WHEN a linked pin is Mod-clicked in Select mode with the view locked THEN the note opens in a new tab. Fixture: pin Rusty Flagon. Also check a plain click opens the note, and that in an edit mode a click selects instead.

### Requirement: Drill-down into a note's maps

- [ ] **Drill into a city map.** WHEN a pin's note has `maps: [...]` and "Open map: <name>" is chosen THEN that map opens. Fixture: pin Westmarch (links to `Places/Westmarch.md`, whose `maps:` lists `all-types.map` and `big-8k.map`): shows the has-map indicator; the popup and context menu list both; choose "Open map: big-8k". (The spec's "Westmarch Sewers" example is not in the vault; big-8k stands in.)
- [ ] **Unresolved entries ignored.** WHEN an entry does not resolve to a `.map` file THEN no action and no error. Fixture: add `"[[Nowhere.map]]"` and `"[[Rusty Flagon]]"` (a note, not a map) to `maps:` in `Places/Westmarch.md`; neither is listed, no errors. (Revert afterwards.)

### Requirement: Rename listener keeps links valid

- [ ] **Note renamed in Obsidian.** WHEN `Rusty Flagon.md` is renamed to `The Rusty Flagon.md` in Obsidian THEN every pin in every map linking to it now has `link: "The Rusty Flagon"` and still resolves. Fixture: rename in the explorer; check `all-types.map` (pin Rusty Flagon) and `big-8k.map` ("South-east"), open or closed. Nothing else in those files changes beyond canonical reformatting.
- [ ] **Image moved.** WHEN `Maps/fixture-4k.png` is moved to `Assets/fixture-4k.png` in Obsidian THEN `image.path` of each referencing map becomes `Assets/fixture-4k.png`. Fixture: `all-types.map`, `broken-links.map`, `missing-image.map` reference it; check the first two (the third references `does-not-exist.png`).
- [ ] **Folder renamed.** WHEN a folder containing linked notes is renamed THEN every affected link that no longer resolves unchanged is rewritten. Fixture: rename the `Places` folder to `Locations`; pins still resolve (links either unchanged because the note names are unique, or rewritten).

### Requirement: Broken links are visible, never deleted

- [ ] **Renamed outside Obsidian.** WHEN a linked note is renamed outside Obsidian and the map is opened THEN the pin shows the broken badge and keeps its original `link`. Fixture: with the vault closed or via a file manager/terminal, rename `Places/Rusty Flagon.md`; open `all-types.map`; the file's `link` is unchanged. Also `broken-links.map` shows badges on "Nowhere Inn" and "Lost City gates" but not on "The Keep (resolves)".
- [ ] **Relink.** WHEN "Relink…" is used on a broken pin and a note picked THEN `link` is updated, the badge disappears, and it is saved. Fixture: scratch copy of `broken-links.map`, pin "Nowhere Inn" relinked to Rusty Flagon.

### Requirement: Find broken pins command

- [ ] **Vault-wide scan.** WHEN two maps each have one pin linking to a missing note and the command runs THEN both are listed under their maps, each with "Open map" and "Relink…". Fixture: `broken-links.map` (two broken pins) plus a scratch copy of `all-types.map` with one pin's link changed to a missing note; "Open map" centres on and selects the pin; "Relink…" fixes it and removes it from the list. With no broken pins, the command shows "No broken pins" (delete the scratch copies first).

## plugin-settings

### Requirement: Settings tab

- [ ] **Defaults.** WHEN the plugin is freshly installed THEN maps property `maps`, overrides off, empty override property names, default pin medium `pin` `#A7A7A7`. Fixture: delete `test-vault/.obsidian/plugins/mythical-maps/data.json` (or use a new vault), reload the plugin, open Settings, Mythical Maps. Also `data.json` contains no map data.
- [ ] **Custom maps property.** WHEN the maps property is set to `region-maps` THEN drill-down reads `region-maps` and ignores `maps`. Fixture: set `region-maps`; the Westmarch pin no longer shows the has-map indicator; rename the `maps:` key in `Places/Westmarch.md` to `region-maps` and it returns. (Revert both afterwards.)

### Requirement: Optional frontmatter style overrides

- [ ] **Colour override.** WHEN overrides are enabled, the colour property is `faction-color`, and the linked note has `faction-color: "#AA2233"` THEN the pin is drawn `#AA2233` while the stored `iconColor` is unchanged. Fixture: pin "The Keep" in `all-types.map` (inside the hidden folder: toggle it visible); enable overrides, set Colour property `faction-color`. The file still has no `iconColor` for it.
- [ ] **Overrides disabled.** WHEN overrides are disabled THEN pins use stored style regardless of frontmatter. Fixture: switch the toggle off; The Keep reverts to the default `#A7A7A7`.
- [ ] **Invalid override value.** WHEN the colour property holds `not-a-colour` THEN the pin uses its stored colour. Fixture: temporarily set `faction-color: not-a-colour` in `Places/The Keep.md`; pin falls back to stored/default colour. (Revert.)
- [ ] **Note frontmatter changes.** WHEN an open map shows a pin with an active override and the note's value is edited THEN the pin re-renders without reopening the map. Fixture: with `all-types.map` open next to `Places/The Keep.md`, change `faction-color` to `#00AA44`; the pin recolours live.

### Requirement: Style resolution order

- [ ] **Partial style.** WHEN a pin stores only `iconGlyph` and has no override THEN colour, shape and size come from the plugin defaults. Fixture: "The Keep" (stores no style) or a scratch pin with only `iconGlyph`; changing the default pin colour in Settings recolours it, while a pin with its own stored colour is unaffected.

## Sign-off

- [ ] All 65 scenarios above ticked (or failures filed as beads).
- [ ] `npm run check` passes on the commit that was tested.
- [ ] Scratch files removed and `git status test-vault` clean (apart from intended fixture changes).
