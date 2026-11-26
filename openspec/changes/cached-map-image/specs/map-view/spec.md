## ADDED Requirements

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
