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

### Requirement: Hide the feature panel
The system SHALL let the user hide the feature panel, including the properties form, and show it again, from the map tab and with a command. Hiding SHALL work on a locked map, SHALL NOT change the `.map` file, and SHALL be remembered for that tab.

#### Scenario: Hide and show
- **WHEN** the user hides the panel and then shows it
- **THEN** the map is uncovered while hidden, and the panel returns with the same selection

#### Scenario: Reload
- **WHEN** the user hides the panel and reopens Obsidian with that tab
- **THEN** the panel is still hidden
