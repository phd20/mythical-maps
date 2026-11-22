import { Plugin } from "obsidian";
import { mergeSettings, type MythicalMapsSettings } from "./obsidian/settings";
import { MythicalMapsSettingTab } from "./obsidian/settingsTab";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "./obsidian/constants";
import { MapView } from "./obsidian/mapView";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override settings: MythicalMapsSettings = mergeSettings(null);

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MythicalMapsSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_MAP, (leaf) => new MapView(leaf));
    this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
  }

  override onunload(): void {
    // Obsidian disposes everything registered via this.register* automatically.
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
