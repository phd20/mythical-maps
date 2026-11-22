## ADDED Requirements

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
