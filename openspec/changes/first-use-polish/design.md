## Context

See proposal.md. The properties form takes Obsidian behaviour through its host interface, so it stays testable against the mocks.

## Goals / Non-Goals

**Goals:** less typing and recall when editing pins; more map space on demand.

**Non-Goals:** a custom colour picker, a palette of saved colours, collapsing the Features and Properties sections separately, a resizable panel, and filling the name when a link is typed by hand.

## Decisions

- **Icon suggestions** use Obsidian's `AbstractInputSuggest` on the existing text box, injected through the form host. Matching and ranking are pure (`core/iconSearch.ts`). Free text stays allowed, and the stored value drops the `lucide-` prefix.
- **Colour picker** is a native `input[type=color]` (what Obsidian's `ColorComponent` renders) beside the text box. The text box stays the source of "blank means default", which a colour input cannot express. The picker commits on `change`, so one pick is one undo step.
- **Hidden panel** is view state, like zoom: toggled from a tab header button, a button in the panel and a command, and kept with the Obsidian workspace layout. It is never written to the `.map` file.
- **Auto name** is one pure patch (`linkPatch`) used by every note picker, so link and name change in a single undo step. The default "New pin" counts as no name, since every new pin has it; any other name is never replaced.
- **Pin centring:** the teardrop's round part is centred in the icon box, so the glyph is no longer raised for that shape.

## Risks / Trade-offs

- A hidden panel hides the properties form too; selecting a feature does not reopen it.
