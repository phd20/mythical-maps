import { Plugin } from "obsidian";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override async onload(): Promise<void> {
    // Intentionally empty in the scaffold: views, commands and settings register here.
  }

  override onunload(): void {
    // Obsidian disposes everything registered via this.register* automatically.
  }
}
