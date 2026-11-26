# map-editing Specification

## Purpose
Creating, selecting, editing, moving and deleting features and folders, their styling, the lock toggle, undo, and saving to the `.map` file.
## Requirements
### Requirement: Create features
The system SHALL let the user create pins and labels by clicking a position, and regions and paths by drawing vertices, using toolbar modes (Select, Pin, Label, Region, Path). It SHALL also offer "Add pin here" on Shift-click and in the map context menu. New features SHALL go into the currently selected folder, or the root when none is selected, as the last sibling.

#### Scenario: Add a pin
- **WHEN** the user picks Pin mode and clicks the map
- **THEN** a pin is created at that position with a new id and default style, it is selected, and the map is saved

#### Scenario: Draw a region
- **WHEN** the user picks Region mode, clicks at least three vertices and finishes the shape
- **THEN** a region with those vertices is created and saved

#### Scenario: Too few vertices
- **WHEN** the user finishes a region with fewer than three vertices or a path with fewer than two
- **THEN** no feature is created

### Requirement: Select and edit properties
The system SHALL show the selected feature's properties in the feature panel: name, link (pins), style fields for its type, `labelVisibility`, `isHidden` and `visibilityRange`. Changes SHALL apply to the map immediately and be saved.

#### Scenario: Rename a pin
- **WHEN** the user edits the selected pin's name in the panel
- **THEN** the pin's label updates on the map and the new name is saved to the file

#### Scenario: Invalid colour input
- **WHEN** the user enters a colour that is not `#RRGGBB`
- **THEN** the field shows an error and the stored colour is unchanged

### Requirement: Move and reshape features
The system SHALL let the user drag pins and labels to new positions, and move, add or remove vertices of regions and paths while in Select mode.

#### Scenario: Drag a pin
- **WHEN** the user drags a pin and releases it
- **THEN** the pin's `pos` is updated to the drop position and saved

### Requirement: Delete features
The system SHALL delete the selected feature with the Delete key or the context menu. Deleting a folder that has descendants SHALL ask for confirmation and then delete the whole subtree.

#### Scenario: Delete a folder with children
- **WHEN** the user deletes a folder containing two pins and confirms
- **THEN** the folder and both pins are removed and the map is saved

#### Scenario: Cancel folder delete
- **WHEN** the user cancels the confirmation
- **THEN** nothing is removed

### Requirement: Folder tree management
The feature panel SHALL show all features as a tree ordered by `rank`, and SHALL let the user create, rename and delete folders, toggle `isHidden`, and drag features to reorder them or move them into another folder, updating `parentId` and `rank`.

#### Scenario: Move into folder
- **WHEN** the user drags a pin onto the folder "Towns"
- **THEN** the pin's `parentId` becomes the folder's id, it becomes the folder's last child, and the change is saved

#### Scenario: No cycles
- **WHEN** the user drags a folder into one of its own descendants
- **THEN** the move is refused and the tree is unchanged

### Requirement: Reveal from the feature panel
Clicking a pin, label, region or path in the feature panel SHALL select it and centre the map on it without changing the zoom. For a region or path, the centre is the middle of its bounding box. Clicking a folder, or selecting a feature on the map, SHALL NOT move the view.

#### Scenario: Click a pin in the panel
- **WHEN** the user is zoomed in elsewhere and clicks a pin's row in the feature panel
- **THEN** the pin is selected, the map pans to centre on it, and the zoom is unchanged

#### Scenario: Click a folder in the panel
- **WHEN** the user clicks a folder's row
- **THEN** the folder is selected and the view does not move

### Requirement: Lock toggle
The system SHALL provide a lock toggle per open view. While locked, every create, edit, move, reshape, reorder and delete action SHALL be refused at the model layer, while pan, zoom, hover and clicking links keep working. The lock state SHALL NOT be stored in the file.

#### Scenario: Locked drag
- **WHEN** the view is locked and the user tries to drag a pin
- **THEN** the pin does not move and the file is not modified

### Requirement: Saving
The system SHALL save edits to the `.map` file through debounced saves in canonical serialization, and SHALL NOT lose edits when the view is closed or Obsidian quits normally.

#### Scenario: Close right after edit
- **WHEN** the user moves a pin and immediately closes the tab
- **THEN** the new position is present in the file

### Requirement: Undo within a session
The system SHALL support undo and redo (Mod+Z / Mod+Shift+Z while the map view is focused) of model edits made in that view since it was opened.

#### Scenario: Undo delete
- **WHEN** the user deletes a pin and then presses Mod+Z
- **THEN** the pin is restored with its original id and properties, and saved

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

