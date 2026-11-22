## ADDED Requirements

### Requirement: Map files open in a map view
The system SHALL register the `.map` extension and open such files in a dedicated map view tab that renders the map's image with Leaflet in `CRS.Simple`, using the bounds from the map-file coordinate frame.

#### Scenario: Open a map
- **WHEN** the user opens `Maps/westmarch.map` from the file explorer
- **THEN** a map view tab shows the referenced image, fitted to the view, with pan and zoom by mouse wheel, drag and double-click

#### Scenario: Missing image
- **WHEN** the map's `image.path` does not resolve to a vault file
- **THEN** the view shows a "Image not found: <path>" notice with a "Choose image…" action, and features are still listed in the feature panel

#### Scenario: Invalid file
- **WHEN** the file fails validation
- **THEN** the view shows the list of validation errors and no map, and makes no write to the file

### Requirement: Opening viewport and zoom limits
The system SHALL open the map at `viewport` when present and otherwise fit the whole image. It SHALL allow zooming from the level that fits the whole image up to native zoom `z + 2`.

#### Scenario: Saved viewport
- **WHEN** a map with `viewport { center: [-96, 128], zoom: 3 }` is opened
- **THEN** the map opens centred at `[-96, 128]` at zoom 3

#### Scenario: Set opening view
- **WHEN** the user chooses "Set current view as default"
- **THEN** the current centre and zoom are saved as `viewport`

### Requirement: Correct sizing
The system SHALL size the map correctly on first render and after any container size change, including sidebar toggles, split resizing and pop-out windows. It SHALL defer the initial fit until the container has a non-zero size.

#### Scenario: Opened in a background tab
- **WHEN** a map is opened in a tab that is not visible and the user later switches to it
- **THEN** the image fills the view at the correct fit without manual interaction

#### Scenario: Pane resize
- **WHEN** the pane containing the map is resized
- **THEN** the map redraws to the new size with no grey or blank areas

### Requirement: Pop-out window support
The system SHALL support panning, zooming, dragging features and all editing in an Obsidian pop-out window exactly as in the main window.

#### Scenario: Drag in pop-out
- **WHEN** a map is moved to a pop-out window and the user drags the map and then drags a pin
- **THEN** both drags follow the pointer and finish on release

### Requirement: Feature rendering
The system SHALL render pins as icon markers (shape, glyph, colour and size from the resolved style), labels as text at `pos`, regions as filled polygons, and paths as polylines, each with its resolved style and its name label according to `labelVisibility`.

#### Scenario: All types render
- **WHEN** a map containing one feature of each drawable type is opened
- **THEN** each appears at its stored coordinates with its stored style

### Requirement: Visibility rules
The system SHALL hide a feature when it or any ancestor folder has `isHidden: true`, or when the current zoom lies outside its `visibilityRange`, mapped linearly from 0–1 onto the map's minimum to maximum zoom.

#### Scenario: Hidden folder hides descendants
- **WHEN** the user toggles a folder's visibility off
- **THEN** every feature under that folder, at any depth, disappears, and reappears when toggled on

#### Scenario: Zoom-gated feature
- **WHEN** a label has `visibilityRange [0.5, 1]` and the map is zoomed out to its minimum
- **THEN** the label is not shown, and it appears once zoom passes the midpoint

### Requirement: Live reload on external change
The system SHALL re-render an open map when its `.map` file is changed on disk by something other than this view (for example Claude, git or sync), provided the view has no unsaved edits, while preserving the current pan and zoom.

#### Scenario: External edit
- **WHEN** an open map's file is modified externally to add a pin
- **THEN** the pin appears in the open view without reopening it, and the view keeps its pan and zoom
