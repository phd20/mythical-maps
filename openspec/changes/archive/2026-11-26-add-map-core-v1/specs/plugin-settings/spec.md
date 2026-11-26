## ADDED Requirements

### Requirement: Settings tab
The system SHALL provide a settings tab with: the maps property name (default `maps`); an "Enable frontmatter style overrides" toggle (default off); optional property names for icon, colour and shape overrides (default empty); and the default pin style (glyph, colour, shape, size). Settings SHALL persist in the plugin's `data.json` and SHALL contain no map data.

#### Scenario: Defaults
- **WHEN** the plugin is installed fresh
- **THEN** the maps property is `maps`, overrides are disabled, every override property name is empty, and the default pin is a medium `pin` coloured `#A7A7A7`

#### Scenario: Custom maps property
- **WHEN** the user sets the maps property to `region-maps`
- **THEN** drill-down reads `region-maps` from linked notes and ignores `maps`

### Requirement: Optional frontmatter style overrides
When overrides are enabled and a property name is configured, a linked pin SHALL use the linked note's value for that property in place of its stored style field. Overrides SHALL apply only to linked pins, only for configured and valid values, and SHALL never be written to the `.map` file. Pins SHALL be created and styled in the map without needing any frontmatter.

#### Scenario: Colour override
- **WHEN** overrides are enabled, the colour property is set to `faction-color`, and a pin's linked note has `faction-color: "#AA2233"`
- **THEN** the pin is drawn `#AA2233` while its stored `iconColor` in the file is unchanged

#### Scenario: Overrides disabled
- **WHEN** overrides are disabled
- **THEN** pins are drawn with their stored style regardless of note frontmatter

#### Scenario: Invalid override value
- **WHEN** the configured colour property holds `not-a-colour`
- **THEN** the pin uses its stored colour

#### Scenario: Note frontmatter changes
- **WHEN** an open map shows a pin with an active override and the linked note's property value is edited
- **THEN** the pin re-renders with the new value without the map being reopened

### Requirement: Style resolution order
The system SHALL resolve each style field as: valid frontmatter override (when enabled and configured), then the feature's stored style, then the plugin's default for that feature type.

#### Scenario: Partial style
- **WHEN** a pin stores only `iconGlyph` and has no override
- **THEN** its colour, shape and size come from the plugin defaults
