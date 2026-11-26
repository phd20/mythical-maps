## Why

Today's Obsidian map plugins (Zoom Map, Obsidian Leaflet) declare maps through custom code blocks inside markdown notes, and some even store marker data inline in those notes. That mixes map data into prose, is fragile to parse, and breaks when notes are renamed. Mythical Maps makes a map a first-class vault file, modelled on LegendKeeper's map model: the map file owns its image, coordinates and features, and notes are only linked to, never used as the source of map data.

## What Changes

- New Obsidian plugin from scratch. The repo is empty today; this change scaffolds the TypeScript and esbuild plugin, the test harness and a test vault.
- A new `.map` file type: versioned, pretty-printed JSON that is the single source of truth for one map. It holds an image reference, the image size, an opening viewport, and a list of features.
- A LegendKeeper-compatible coordinate frame (Leaflet `CRS.Simple`, `pos = [-y / 2^z, x / 2^z]`), so tiling can be added later without changing stored coordinates.
- A map tab view: opening a `.map` file shows a Leaflet map of a single image with pan and zoom. It works in pop-out windows and resizes correctly.
- Feature editing for five feature types: **pin**, **label**, **region**, **path** and **folder**. Folders form a hierarchy and can be shown or hidden. Any feature can be limited to a zoom range. A lock toggle prevents accidental edits.
- Pins link to notes by linktext. Hovering a pin shows Obsidian's page preview and clicking opens the note. If the linked note lists maps in a user-named frontmatter property, you can drill down into those maps.
- Link upkeep: a rename listener rewrites pin links when notes are renamed inside Obsidian. A "Find broken pins" command, plus a broken-pin marker on the map, catches renames made outside Obsidian (for example by Claude or git).
- Optional frontmatter style overrides: the user names frontmatter properties (for example `map-icon`, `faction-color`) that override a linked pin's stored icon and colour. Off by default.
- A "New map from image" command.
- A settings tab for property names, defaults and the override switches.

**Out of scope (follow-ups):** embedding `![[X.map]]` in notes (needs a spike first), fog of war and a player view, distance measurement and scale, multiple base images or overlays, local tiling for very large or mobile maps, drawing and grids, a plugin-owned "appears on maps" panel, and any LegendKeeper API integration. Obsidian backlinks and the graph will not include map links.

## Capabilities

### New Capabilities
- `map-file`: the `.map` JSON schema, versioning and migration, validation, the coordinate frame, stable ids and ordering, deterministic serialization, and the "New map from image" command.
- `map-view`: registering the file type and tab view, Leaflet rendering of the image, the viewport, zoom-range visibility, folder visibility, pop-out window and resize behaviour, and reloading when the file changes on disk.
- `map-editing`: creating, selecting, editing, moving and deleting pins, labels, regions, paths and folders; feature styling; the lock toggle; and saving back to the `.map` file.
- `note-links`: pin-to-note links, hover preview and opening notes, drill-down through a user-named maps property, the rename listener, broken-pin detection, the broken-pin marker and the "Find broken pins" command.
- `plugin-settings`: the settings tab, user-defined frontmatter property names, the optional style override and how styles are resolved.

### Modified Capabilities
<!-- none: greenfield project -->

## Impact

- **New code:** the whole plugin (`src/`), `manifest.json`, `package.json`, `esbuild.config.mjs`, `styles.css`, the tests and `test-vault/`.
- **Dependencies:** `obsidian` (types), `leaflet` 1.9.x, `@geoman-io/leaflet-geoman-free` (geometry editing), `zod` (schema validation), `fractional-indexing` (rank), `vitest`, `typescript`, `esbuild` and `eslint`.
- **Platforms:** desktop is the target. The manifest has `isDesktopOnly: false`; mobile works best-effort but is not verified in v1.
- **Implementation process:** the work is broken into bead-sized tasks with explicit dependencies, each passing `npm run check` (types, lint, tests, build) plus its own acceptance criteria, so automated loops can complete them one at a time.
