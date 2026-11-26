# map-view Specification

## Purpose
The map tab: opening `.map` files, rendering the image and features, viewport and zoom, visibility, sizing and pop-out windows, and reloading when the file changes on disk.
## Requirements
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

### Requirement: Smooth continuous zoom
The system SHALL zoom continuously, not in discrete steps, when the user zooms with a mouse wheel, a trackpad scroll or a trackpad pinch. Each input event SHALL change the zoom by an amount proportional to its scroll delta, anchored on the pointer, and the result SHALL be clamped to the zoom limits. Zoom levels SHALL NOT be snapped, so any fractional zoom can be reached and saved as `viewport.zoom`. Double-click and the zoom buttons MAY zoom in animated whole steps.

#### Scenario: Trackpad pinch
- **WHEN** the user pinches slowly on a trackpad over a point on the map
- **THEN** the image scales smoothly with the gesture, with no visible jumps between zoom levels, and the point under the pointer stays under the pointer

#### Scenario: Mouse wheel
- **WHEN** the user scrolls a mouse wheel several notches over the map
- **THEN** the zoom changes by a small amount per notch and eases between them, without jumping a whole zoom level per notch

#### Scenario: Zoom limits
- **WHEN** the user keeps zooming in or out
- **THEN** the zoom stops smoothly at the minimum (fit) and maximum (`z + 2`) without overshooting or bouncing

#### Scenario: Pop-out window
- **WHEN** the map is in a pop-out window
- **THEN** wheel and pinch zoom behave exactly as in the main window

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

### Requirement: Centred pin icon
A pin's icon SHALL appear centred in the main body of its icon shape.

#### Scenario: Pin shape
- **WHEN** a pin uses the "pin" icon shape
- **THEN** its icon is centred in the round part of the teardrop

### Requirement: Large images stay ready to zoom
For a still raster image over 8 megapixels and within the size limits (neither side over 16384 pixels, at most 100 megapixels), the system SHALL decode the image once per opened map and keep it ready while the map is open, so that zooming and panning never wait for the image to be decoded again.

#### Scenario: Zoom after a pause
- **WHEN** a map with a 6144 × 8192 image has been shown, left untouched for two minutes, and the user then zooms with a trackpad
- **THEN** the zoom follows the gesture from the start, with no freeze followed by a jump

#### Scenario: Return to the window
- **WHEN** the user minimizes Obsidian or works in another app, returns, and zooms
- **THEN** the zoom follows the gesture from the start

### Requirement: Map usable while the image is prepared
While a large image is being prepared, the system SHALL show the map with its features at their positions and keep it responsive, and SHALL show the image as soon as it is ready without changing the view.

#### Scenario: Opening a large map
- **WHEN** the user opens a map with a large image
- **THEN** pins are shown at once, the image appears shortly after in the same position and zoom, and the app does not freeze

#### Scenario: Closed before ready
- **WHEN** the user closes the map before its image has appeared
- **THEN** no error is shown and nothing of the image stays in memory

### Requirement: Other images render as before
The system SHALL render SVG images, GIF and other detected animated images, images of 8 megapixels or less, images over the size limits, and any image it fails to prepare, with an ordinary image element.

#### Scenario: Animated image
- **WHEN** a map's image is an animated GIF or animated WebP
- **THEN** it is shown and keeps animating

#### Scenario: Preparation fails
- **WHEN** a large image cannot be prepared
- **THEN** the map still shows the image as an ordinary image element

### Requirement: Cached image follows the map's life
The system SHALL show the current image file in every window, and SHALL free a cached image when its map view closes or is remounted.

#### Scenario: Image replaced
- **WHEN** an open map's image file is replaced and the map next reloads
- **THEN** the new image is shown

#### Scenario: Pop-out window
- **WHEN** a map with a large image is opened in or moved to a pop-out window
- **THEN** the image is shown, and zooms as in the main window

### Requirement: Zoomed-out image quality
A cached image SHALL look no grainier or darker than the same image in an ordinary image element at any zoom level.

#### Scenario: Fully zoomed out
- **WHEN** a detailed large map is zoomed out to fit
- **THEN** fine detail such as tree canopies and outlines looks as smooth as it did before caching

