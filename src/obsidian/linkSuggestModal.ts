/**
 * Fuzzy note picker for a pin's `link` (bead 6.1, spec note-links "Set link
 * with picker"). Choosing a note gives its shortest unambiguous linktext;
 * "Clear link" (offered when a link is set) gives null. Typing a link by hand
 * stays possible in the properties form's text box.
 */
import { FuzzySuggestModal, type App } from "obsidian";
import { linkChoices, type LinkChoice } from "../core/linkPicker";

/** Title of the item that clears the link. */
export const CLEAR_LINK_TITLE = "Clear link";

type Item = LinkChoice | { clear: true };

const isClear = (item: Item): item is { clear: true } => "clear" in item;

export class LinkSuggestModal extends FuzzySuggestModal<Item> {
  constructor(
    app: App,
    private readonly mapPath: string,
    private readonly hasLink: boolean,
    private readonly onChoose: (linktext: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose the note to link…");
  }

  override getItems(): Item[] {
    const choices = linkChoices(
      this.app.vault.getMarkdownFiles().map((f) => f.path),
      this.mapPath,
      (path, mapPath) => {
        const file = this.app.vault.getFileByPath(path);
        return file ? this.app.metadataCache.fileToLinktext(file, mapPath, true) : path.replace(/\.md$/i, "");
      },
    );
    return this.hasLink ? [{ clear: true }, ...choices] : choices;
  }

  override getItemText(item: Item): string {
    return isClear(item) ? CLEAR_LINK_TITLE : item.path;
  }

  override onChooseItem(item: Item): void {
    this.onChoose(isClear(item) ? null : item.linktext);
  }
}
