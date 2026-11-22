/**
 * Fuzzy picker over the vault's image files, for "Choose image…" on a map
 * whose image is missing (spec map-view "Missing image").
 */
import { FuzzySuggestModal, type App, type TFile } from "obsidian";
import { isImageFile } from "./newMapCommand";

/** Every vault file with an image extension "New map from image" accepts, sorted by path. */
export function vaultImageFiles(app: App): TFile[] {
  return app.vault
    .getFiles()
    .filter((f) => isImageFile(f))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
  constructor(
    app: App,
    private readonly files: TFile[],
    private readonly onChoose: (file: TFile) => void,
  ) {
    super(app);
    this.setPlaceholder("Choose the map image…");
  }

  override getItems(): TFile[] {
    return this.files;
  }

  override getItemText(file: TFile): string {
    return file.path;
  }

  override onChooseItem(file: TFile): void {
    this.onChoose(file);
  }
}
