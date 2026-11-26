## Context

See proposal.md. The properties form takes Obsidian behaviour through its host interface, so it stays testable against the mocks.

## Goals / Non-Goals

**Goals:** less typing and recall when editing pins; more map space on demand.

**Non-Goals:** a custom colour picker, a palette of saved colours, separate tabs for Features and Properties, and filling the name when a link is typed by hand.

## Decisions

- **Icon suggestions** use Obsidian's `AbstractInputSuggest` on the existing text box, injected through the form host. Matching and ranking are pure (`core/iconSearch.ts`). Free text stays allowed, and the stored value drops the `lucide-` prefix.
- **Colour picker** is a native `input[type=color]` (what Obsidian's `ColorComponent` renders) beside the text box. The text box stays the source of "blank means default", which a colour input cannot express. The picker commits on `change`, so one pick is one undo step.
- **Sidebar panel** is its own `ItemView` in the right sidebar, so Obsidian supplies collapsing, resizing and placement. It shows the most recently used leaf of the main area or a pop-out (`getMostRecentLeaf`) when that is a map, and a short message otherwise, so clicking in a sidebar changes nothing. The map view keeps owning the model, selection and every edit; the panel only calls into it. Because the panel is a separate view, it binds undo, redo and delete itself, and map commands also work while it has focus.
- **Adding the tab:** the first time a map opens, the tab is added without taking focus or covering the tab in use, and `panelAdded` is saved in the settings so a closed tab stays closed. A map header button and a command reveal it.
- **Auto name** is one pure patch (`linkPatch`) used by every note picker, so link and name change in a single undo step. The default "New pin" counts as no name, since every new pin has it; any other name is never replaced.
- **Pin centring:** the teardrop's round part is centred in the icon box, so the glyph is no longer raised for that shape.

## Risks / Trade-offs

- With the sidebar collapsed, selecting a feature does not open it.
- A map in a pop-out window is edited from the main window's sidebar.
- `panelAdded` lives in the plugin settings; a vault synced to another device will not add the tab there (the button and command do).
