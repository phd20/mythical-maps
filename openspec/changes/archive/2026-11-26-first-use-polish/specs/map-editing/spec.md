## ADDED Requirements

### Requirement: Icon suggestions
While the user types in a pin's Icon field, the system SHALL suggest matching Lucide icons, showing each icon and its name. Choosing a suggestion SHALL set the pin's icon. Typing a name by hand SHALL keep working.

#### Scenario: Search for an icon
- **WHEN** the user types "cast" in the Icon field
- **THEN** icons whose names contain "cast", such as "castle", are listed with previews

#### Scenario: Choose a suggestion
- **WHEN** the user chooses "castle" from the list
- **THEN** the pin shows the castle icon, `iconGlyph` is saved as "castle", and one undo restores the previous icon

### Requirement: Colour picker
Every colour field in the properties form SHALL offer a colour picker beside its hex text box. The picker SHALL show the stored colour, or the default when none is stored.

#### Scenario: Pick a colour
- **WHEN** the user picks a colour with the picker
- **THEN** the text box shows it as `#RRGGBB`, the feature uses it, and it is saved

#### Scenario: Clear back to the default
- **WHEN** the user empties the hex text box
- **THEN** the stored colour is removed and the picker shows the default colour

### Requirement: Map panel in the sidebar
The system SHALL show the feature tree and the properties form in a tab of Obsidian's right sidebar, not over the map. The tab SHALL follow the map last used in the main area or a pop-out window, and SHALL say that no map is open when that tab is not a map. The system SHALL add the tab, without taking focus, the first time a map is opened, SHALL NOT add it again once the user closes it, and SHALL reveal it from the map tab and with a command. Undo, redo and delete SHALL work while the panel has focus.

#### Scenario: First map
- **WHEN** the user opens a map for the first time
- **THEN** a map panel tab appears in the right sidebar, the map keeps focus, and nothing covers the map

#### Scenario: Follow the map
- **WHEN** the user switches from one map to another, and then to a note
- **THEN** the panel shows the first map, then the second, then a message that no map is open

#### Scenario: Work in the panel
- **WHEN** the user clicks in the panel, deletes the selected pin and presses Mod+Z
- **THEN** the panel still shows the same map and the pin is deleted and then restored

#### Scenario: Closed stays closed
- **WHEN** the user closes the panel tab and opens another map
- **THEN** the tab is not added again, and the map header button brings it back
