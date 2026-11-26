## ADDED Requirements

### Requirement: Name an unnamed pin from its note
When the user chooses a note for a pin that has no name, the system SHALL set the pin's name to the note's name, as one edit with the link. A pin has no name when the name is blank or is still the one new pins are given ("New pin"). It SHALL NOT replace any other name.

#### Scenario: Unnamed pin
- **WHEN** the user chooses "Places/Westmarch" for a pin with no name
- **THEN** the pin is linked and named "Westmarch", and one undo removes both

#### Scenario: New pin
- **WHEN** the user creates a pin and chooses "Places/Westmarch" for it without renaming it
- **THEN** the pin is named "Westmarch"

#### Scenario: Named pin
- **WHEN** the user chooses a note for a pin already named "The old keep"
- **THEN** only the link changes
