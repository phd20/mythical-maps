## Why

First use of the 0.1.0 beta in an existing vault showed friction when editing pins: icon names and hex colours have to be known by heart, the feature panel always covers part of the map, naming a linked pin repeats the note's name by hand, and the icon on the teardrop pin shape sits visibly high.

## What Changes

- The Icon field suggests Lucide icons, with previews, as the user types.
- Every colour field gets a colour picker beside the hex text box.
- The feature panel (features and properties) moves from a floating overlay on the map to a tab in the right sidebar.
- Choosing a note for a pin with no name also names the pin after the note.
- The icon on the "pin" icon shape is centred in the shape.

## Capabilities

### New Capabilities

### Modified Capabilities
- `map-editing`: icon suggestions, colour picker, the feature panel in the sidebar.
- `note-links`: naming an unnamed pin from the chosen note.
- `map-view`: icon centring on the pin shape.

## Impact

`src/ui/propertiesForm.ts`, `src/obsidian/mapView.ts`, `src/obsidian/panelView.ts`, `src/obsidian/settings.ts`, `src/obsidian/findBrokenPins.ts`, `src/core/`, `styles.css`, and a new icon suggester in `src/obsidian/`. No change to the `.map` format or to the minimum Obsidian version (1.5.0).
