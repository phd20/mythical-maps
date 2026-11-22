/**
 * Confirmation before deleting a folder that has descendants (bead 5.6, spec
 * map-editing "Delete features"). Resolves true on "Delete", false on "Cancel"
 * or when the modal is dismissed any other way (Escape, click outside).
 */
import { Modal, type App } from "obsidian";

export const DELETE_CONFIRM_TITLE = "Delete folder?";
export const DELETE_BUTTON_TEXT = "Delete";
export const CANCEL_BUTTON_TEXT = "Cancel";

/** Message shown in the dialog, with the descendant count. */
export function deleteConfirmMessage(name: string, descendantCount: number): string {
  const items = `${descendantCount} ${descendantCount === 1 ? "feature" : "features"}`;
  return `Delete "${name}" and the ${items} inside it? You can undo this with Mod+Z.`;
}

export class DeleteConfirmModal extends Modal {
  private choice = false;
  private resolveChoice: (ok: boolean) => void = () => undefined;
  /** Settles once the modal closes. */
  readonly result: Promise<boolean>;

  constructor(
    app: App,
    private readonly name: string,
    private readonly descendantCount: number,
  ) {
    super(app);
    this.result = new Promise<boolean>((resolve) => {
      this.resolveChoice = resolve;
    });
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: DELETE_CONFIRM_TITLE });
    contentEl.createEl("p", { text: deleteConfirmMessage(this.name, this.descendantCount) });
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: CANCEL_BUTTON_TEXT });
    cancel.addEventListener("click", () => this.close());
    const confirm = buttons.createEl("button", { cls: "mod-warning", text: DELETE_BUTTON_TEXT });
    confirm.addEventListener("click", () => this.confirm());
  }

  /** Confirm and close. */
  confirm(): void {
    this.choice = true;
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
    this.resolveChoice(this.choice);
  }
}

/** Open the dialog and wait for the user's answer. */
export function confirmDelete(app: App, name: string, descendantCount: number): Promise<boolean> {
  const modal = new DeleteConfirmModal(app, name, descendantCount);
  modal.open();
  return modal.result;
}
