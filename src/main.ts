import { Plugin } from "obsidian";
import { mergeSettings, type MythicalMapsSettings } from "./obsidian/settings";
import { MythicalMapsSettingTab } from "./obsidian/settingsTab";
import { MAP_EXTENSION, VIEW_TYPE_MAP } from "./obsidian/constants";
import {
  MapView,
  REDO_COMMAND_ID,
  SET_DEFAULT_VIEW_COMMAND_ID,
  SET_DEFAULT_VIEW_COMMAND_NAME,
  TOGGLE_LOCK_COMMAND_ID,
  UNDO_COMMAND_ID,
} from "./obsidian/mapView";
import { registerMapLinkMaintenance } from "./obsidian/renameListener";
import type { VaultMapIndex } from "./obsidian/vaultMapIndex";
import { registerNewMapFromImage } from "./obsidian/newMapCommand";
import { registerBrokenLinks } from "./obsidian/brokenLinks";
import { registerNoteMaps, type NoteMaps } from "./obsidian/noteMaps";
import { registerStyleOverrides, type StyleOverrides } from "./obsidian/styleOverrides";
import { registerLinkHoverSource } from "./obsidian/linkActions";
import { registerFindBrokenPins } from "./obsidian/findBrokenPins";

/** Mythical Maps plugin entry point. Features are registered by later beads. */
export default class MythicalMapsPlugin extends Plugin {
  override settings: MythicalMapsSettings = mergeSettings(null);
  /** Index of every .map file's links; keeps pin links valid across renames (design D7). */
  mapIndex!: VaultMapIndex;
  /** Frontmatter style overrides for open map views (bead 7.1). */
  styleOverrides!: StyleOverrides;
  /** Drill-down into a pinned note's maps (bead 6.3). */
  noteMaps!: NoteMaps;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MythicalMapsSettingTab(this.app, this));
    // Bead 7.1: style overrides; views get their resolver and re-render on note/settings changes.
    this.styleOverrides = registerStyleOverrides(this, this.app, () => this.settings, () => this.openMapViews());
    this.noteMaps = registerNoteMaps(this, this.app, () => this.settings, () => this.openMapViews());
    // Bead 6.6: the broken badge follows note create/rename/delete; after layout ready so startup indexing does not fire it per file.
    this.app.workspace.onLayoutReady(() => registerBrokenLinks(this, this.app, () => this.openMapViews()));
    this.registerView(VIEW_TYPE_MAP, (leaf) => {
      const view = new MapView(leaf);
      view.noteMaps = this.noteMaps.lookup;
      view.styleSource = (mapPath) => this.styleOverrides.viewFor(mapPath);
      return view;
    });
    this.registerExtensions([MAP_EXTENSION], VIEW_TYPE_MAP);
    this.mapIndex = registerMapLinkMaintenance(this, this.app);
    registerNewMapFromImage(this, this.app);
    registerFindBrokenPins(this, this.app, () => this.mapIndex); // bead 6.7
    registerLinkHoverSource(this); // bead 6.2: page preview on pins
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
    this.registerMapEditCommands();
  }

  /** Undo, redo and lock as commands on the active map view (the view also binds Mod+Z / Mod+Shift+Z). */
  private registerMapEditCommands(): void {
    const activeMapView = (): MapView | null => {
      const view = this.app.workspace.getActiveViewOfType(MapView);
      return view?.mapStore ? view : null;
    };
    this.addCommand({
      id: UNDO_COMMAND_ID,
      name: "Undo map edit",
      checkCallback: (checking) => {
        const view = activeMapView();
        if (!view?.canUndo) return false;
        if (!checking) view.undo();
        return true;
      },
    });
    this.addCommand({
      id: REDO_COMMAND_ID,
      name: "Redo map edit",
      checkCallback: (checking) => {
        const view = activeMapView();
        if (!view?.canRedo) return false;
        if (!checking) view.redo();
        return true;
      },
    });
    this.addCommand({
      id: TOGGLE_LOCK_COMMAND_ID,
      name: "Toggle map lock",
      checkCallback: (checking) => {
        const view = activeMapView();
        if (!view) return false;
        if (!checking) view.toggleLock();
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
