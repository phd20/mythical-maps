## ADDED Requirements

### Requirement: Map file is the single source of truth
The system SHALL store all data for one map in one `.map` file containing JSON with `"type": "mythical-map"`, an integer `version`, an `image` object (`path`, `width`, `height`), an optional `viewport` (`center` as `[lat, lng]`, `zoom`), and a `features` array. The system SHALL NOT read map data from or write map data to markdown notes.

#### Scenario: Valid file loads
- **WHEN** a `.map` file containing a valid version-1 document is parsed
- **THEN** the parser returns a typed map model with every feature intact

#### Scenario: No markdown writes
- **WHEN** any map edit is saved
- **THEN** only the `.map` file is modified and no markdown file changes

### Requirement: Feature model
Each feature SHALL have a unique `id`, a `type` of `pin`, `label`, `region`, `path` or `folder`, an optional `name`, an optional `parentId` naming a `folder` feature, and a `rank`. A `pin` and a `label` SHALL have `pos`. A `region` SHALL have `polygon` or `polygons`. A `path` SHALL have `polyline`. Any feature MAY have `isHidden`, `visibilityRange` (`[min, max]` within 0–1, min ≤ max), and `style` fields named as in LegendKeeper's Feature schema. A `pin` MAY have `link` (Obsidian linktext).

#### Scenario: Pin without position is rejected
- **WHEN** a file contains a `pin` with no `pos`
- **THEN** validation fails with an error naming the feature id and the `pos` field

#### Scenario: Parent must be a folder
- **WHEN** a feature's `parentId` names a feature that is not a `folder` or does not exist
- **THEN** validation fails with an error naming the feature id and `parentId`

#### Scenario: Duplicate ids are rejected
- **WHEN** two features share an `id`
- **THEN** validation fails with an error naming the duplicated id

### Requirement: Invalid files are never overwritten
The system SHALL refuse to write to a `.map` file that failed to parse or validate, and SHALL report every validation issue with its JSON path.

#### Scenario: Invalid JSON
- **WHEN** a `.map` file contains malformed JSON
- **THEN** the parse result is an error with a position, and no save to that file is possible until it parses

#### Scenario: Wrong type marker
- **WHEN** a `.map` file is valid JSON but lacks `"type": "mythical-map"`
- **THEN** it is reported as "not a Mythical map" and left untouched

### Requirement: Versioning and migration
The system SHALL pass every parsed document through `migrate()` to the current version before validation. It SHALL reject versions newer than it supports, with an "upgrade the plugin" message.

#### Scenario: Future version
- **WHEN** a file has `version` greater than the current version
- **THEN** parsing fails with an upgrade message and the file is not modified

### Requirement: Deterministic serialization
The system SHALL serialize a map as 2-space-indented JSON with a fixed key order, features sorted by `parentId`, then `rank`, then `id`, and a trailing newline, so that `stringify(parse(stringify(m))) === stringify(m)`.

#### Scenario: Round trip is stable
- **WHEN** a valid map is serialized, parsed and serialized again
- **THEN** both serialized strings are byte-identical

#### Scenario: Unchanged model does not produce a diff
- **WHEN** a map is loaded and saved with no edits
- **THEN** the file contents are unchanged if they were already in canonical form

### Requirement: LegendKeeper-compatible coordinate frame
The system SHALL use the frame `z = max(0, ceil(log2(max(width, height) / 256)))`, `pos = [-y / 2^z, x / 2^z]` for image pixel `(x, y)` from the top-left, with bounds `[[-height / 2^z, 0], [0, width / 2^z]]`, and SHALL provide `pixelToPos` and `posToPixel` as exact inverses.

#### Scenario: Corner conversion
- **WHEN** the image is 8192×6144 and pixel `(8192, 6144)` is converted
- **THEN** `z` is 5 and `pos` is `[-192, 256]`

#### Scenario: Inverse
- **WHEN** any pixel inside the image is converted to `pos` and back
- **THEN** the result equals the original pixel to within 1e-9

### Requirement: Stable ids and ordering
The system SHALL generate feature ids matching `^[a-z][0-9a-z]{7}$` that are unique within the map, and SHALL generate ranks with fractional indexing so that inserting between any two siblings never requires renumbering others.

#### Scenario: Insert between siblings
- **WHEN** a feature is inserted between siblings with ranks `a0` and `a1`
- **THEN** it receives a rank that sorts strictly between them, and no other feature's rank changes

### Requirement: New map from image
The system SHALL provide a command and a file-menu action on image files ("New map from image") that reads the image's pixel size, creates `<image basename>.map` next to the image (adding a numeric suffix if the name is taken) with no features and a viewport that fits the whole image, and opens it.

#### Scenario: Create from image
- **WHEN** the user runs "New map from image" on `Maps/westmarch.webp` (8192×6144)
- **THEN** `Maps/westmarch.map` is created with `image.path` `Maps/westmarch.webp`, width 8192, height 6144, an empty `features` array, and it opens in the map view

#### Scenario: Name taken
- **WHEN** `Maps/westmarch.map` already exists
- **THEN** the new file is named `Maps/westmarch 1.map` and the existing file is untouched
