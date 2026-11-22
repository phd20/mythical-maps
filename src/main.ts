import { Plugin } from "obsidian";
import { mergeSettings, type MythicalMapsSettings } from "./obsidian/settings";
import { MythicalMapsSettingTab } from "./obsidian/settingsTab";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "./obsidian/constants";
import { MapView } from "./obsidian/mapView";
import { registerMapLinkMaintenance } from "./obsidian/renameListener";
import type { VaultMapIndex } from "./obsidian/vaultMapIndex";
import { registerNewMapFromImage } from "./obsidian/newMapCommand";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override settings: MythicalMapsSettings = mergeSettings(null);
  /** Index of every .map file's links; keeps pin links valid across renames (design D7). */
  mapIndex!: VaultMapIndex;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MythicalMapsSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_MAP, (leaf) => new MapView(leaf));
    this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
    this.mapIndex = registerMapLinkMaintenance(this, this.app);
    registerNewMapFromImage(this, this.app);
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
