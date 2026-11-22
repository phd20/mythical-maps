import { Plugin } from "obsidian";
import { mergeSettings, type MythicalMapsSettings } from "./obsidian/settings";
import { MythicalMapsSettingTab } from "./obsidian/settingsTab";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "./obsidian/constants";
import { MapView, SET_DEFAULT_VIEW_COMMAND_ID, SET_DEFAULT_VIEW_COMMAND_NAME } from "./obsidian/mapView";
import { registerMapLinkMaintenance } from "./obsidian/renameListener";
import type { VaultMapIndex } from "./obsidian/vaultMapIndex";
import { registerNewMapFromImage } from "./obsidian/newMapCommand";
import { registerStyleOverrides, type StyleOverrides } from "./obsidian/styleOverrides";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override settings: MythicalMapsSettings = mergeSettings(null);
  /** Index of every .map file's links; keeps pin links valid across renames (design D7). */
  mapIndex!: VaultMapIndex;
  /** Frontmatter style overrides for open map views (bead 7.1). */
  styleOverrides!: StyleOverrides;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MythicalMapsSettingTab(this.app, this));
    // Bead 7.1: style overrides; views get their resolver and re-render on note/settings changes.
    this.styleOverrides = registerStyleOverrides(this, this.app, () => this.settings, () => this.openMapViews());
    this.registerView(VIEW_TYPE_MAP, (leaf) => {
      const view = new MapView(leaf);
      view.styleSource = (mapPath) => this.styleOverrides.viewFor(mapPath);
      return view;
    });
    this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
    this.mapIndex = registerMapLinkMaintenance(this, this.app);
    registerNewMapFromImage(this, this.app);
    this.addCommand({
      id: SET_DEFAULT_VIEW_COMMAND_ID,
      name: SET_DEFAULT_VIEW_COMMAND_NAME,
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MapView);
        if (!view?.canSetDefaultView()) return false;
        if (!checking) view.setCurrentViewAsDefault();
        return true;
      },
    });
  }

  override onunload(): void {
    // Obsidian disposes everything registered via this.register* automatically.
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.styleOverrides?.refreshAll(); // bead 7.1
  }

  /** Every open map view (bead 7.1). */
  openMapViews(): MapView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MAP)
      .map((leaf) => leaf.view)
      .filter((view): view is MapView => view instanceof MapView);
  }
}
