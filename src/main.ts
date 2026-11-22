import { Plugin } from "obsidian";
import { mergeSettings, type MythicalMapsSettings } from "./obsidian/settings";
import { MythicalMapsSettingTab } from "./obsidian/settingsTab";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override settings: MythicalMapsSettings = mergeSettings(null);

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MythicalMapsSettingTab(this.app, this));
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
