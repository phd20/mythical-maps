## ADDED Requirements

### Requirement: Pins link to notes by linktext
A pin's `link` SHALL be Obsidian linktext (no brackets, optionally with `#heading`), resolved the way Obsidian resolves a wikilink from the map file's location. The feature panel SHALL offer a fuzzy note picker to set or change the link.

#### Scenario: Link resolves after a move
- **WHEN** a pin links to `Rusty Flagon` and that note is moved to another folder without being renamed
- **THEN** the link still resolves to the moved note

#### Scenario: Set link with picker
- **WHEN** the user picks the note `Places/Westmarch.md` in the link picker
- **THEN** the pin's `link` is set to the shortest unambiguous linktext for that note and saved

### Requirement: Hover preview and open note
Hovering a linked pin SHALL trigger Obsidian's standard page preview for the linked note. Clicking a linked pin SHALL open the note, honouring Obsidian's modifier keys for opening in a new tab or split. In edit modes, a click selects the pin instead of opening it.

#### Scenario: Hover
- **WHEN** the user hovers a pin linked to an existing note, with Page Preview enabled
- **THEN** Obsidian's hover preview of that note appears

#### Scenario: Mod-click
- **WHEN** the user Mod-clicks a linked pin in Select mode with the view locked
- **THEN** the note opens in a new tab

### Requirement: Drill-down into a note's maps
When a pin's linked note has a frontmatter list under the configured maps property (default `maps`) containing links to `.map` files, the pin SHALL show a "has map" indicator, and its popup and context menu SHALL list one "Open map: <name>" action for each listed map that resolves.

#### Scenario: Drill into a city map
- **WHEN** a pin links to `Westmarch`, whose frontmatter is `maps: ["[[Westmarch.map]]", "[[Westmarch Sewers.map]]"]`, and the user chooses "Open map: Westmarch Sewers"
- **THEN** `Westmarch Sewers.map` opens in the map view

#### Scenario: Unresolved entries ignored
- **WHEN** an entry in the maps property does not resolve to a `.map` file
- **THEN** no action is shown for that entry and no error is raised

### Requirement: Rename listener keeps links valid
The system SHALL keep an index of every `.map` file's resolved link targets and image path. When a vault file is renamed or moved inside Obsidian, it SHALL atomically rewrite, in every affected `.map` file, each pin `link` that resolved to the old path (to the new shortest linktext) and each `image.path` equal to the old path. It SHALL change nothing else in those files.

#### Scenario: Note renamed in Obsidian
- **WHEN** the note `Rusty Flagon.md` is renamed to `The Rusty Flagon.md` in Obsidian
- **THEN** every pin in every map that linked to it now has `link: "The Rusty Flagon"`, and the pins still resolve

#### Scenario: Image moved
- **WHEN** `Maps/westmarch.webp` is moved to `Assets/westmarch.webp` in Obsidian
- **THEN** `image.path` in each map that referenced it becomes `Assets/westmarch.webp`

#### Scenario: Folder renamed
- **WHEN** a folder containing linked notes is renamed
- **THEN** every affected link that does not still resolve unchanged is rewritten

### Requirement: Broken links are visible, never deleted
A pin whose `link` does not resolve SHALL be drawn with a broken-link badge, and its popup SHALL offer "Relink…". The system SHALL never delete or clear a link automatically because it does not resolve.

#### Scenario: Renamed outside Obsidian
- **WHEN** a linked note is renamed outside Obsidian (for example by Claude or git) and the map is opened
- **THEN** the pin shows the broken-link badge and keeps its original `link` text

#### Scenario: Relink
- **WHEN** the user chooses "Relink…" on a broken pin and picks a note
- **THEN** the pin's `link` is updated, the badge disappears and the map is saved

### Requirement: Find broken pins command
The system SHALL provide a "Find broken pins" command that scans every `.map` file in the vault and lists the broken pins grouped by map, with "Open map" (centred on the pin) and "Relink…" actions. It SHALL report "No broken pins" when there are none.

#### Scenario: Vault-wide scan
- **WHEN** two maps each contain one pin linking to a missing note and the user runs "Find broken pins"
- **THEN** a list shows both pins under their maps, each with "Open map" and "Relink…"
