/**
 * The map panel (spec map-editing "Map panel in the sidebar"): a tab in the
 * right sidebar holding the feature tree and the properties form for the map
 * last used in the main area or a pop-out window.
 *
 * The map view keeps owning the model, the selection and every edit; the panel
 * reads them, calls back into that view, and re-syncs when the view reports a
 * change. It only follows `getMostRecentLeaf`, which ignores the sidebars, so
 * clicking in the panel (or any other sidebar tab) keeps the same map. Being a
 * view of its own, it binds undo, redo and delete itself.
 */
import { ItemView, Scope, type App, type Plugin, type WorkspaceLeaf } from "obsidian";
import { FeaturePanel } from "../ui/featurePanel";
import { PropertiesForm } from "../ui/propertiesForm";
import { IconSuggest } from "./iconSuggest";
import { LinkSuggestModal } from "./linkSuggestModal";
import { MapView, SHOW_PANEL_TITLE } from "./mapView";

export const VIEW_TYPE_PANEL = "mythical-map-panel";
export const PANEL_VIEW_TITLE = "Map features";
export const NO_MAP_TEXT = "Open a map to see its features.";
export const SHOW_PANEL_COMMAND_ID = "show-map-panel";

interface Built {
  view: MapView;
  path: string;
  panel: FeaturePanel;
  form: PropertiesForm;
}

export class MapPanelView extends ItemView {
  /** The map view shown, or null. */
  target: MapView | null = null;
  private unsubscribe: (() => void) | null = null;
  private built: Built | null = null;
  private emptyShown = false;
  /** Collapsed folders per map path, kept while the panel is open. */
  private readonly collapsed = new Map<string, Set<string>>();

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    this.scope.register(["Mod"], "z", (evt) => this.target?.handleHistoryKey(evt, "undo") ?? true);
    this.scope.register(["Mod", "Shift"], "z", (evt) => this.target?.handleHistoryKey(evt, "redo") ?? true);
    this.scope.register([], "Delete", (evt) => this.target?.handleDeleteKey(evt) ?? true);
    this.scope.register([], "Backspace", (evt) => this.target?.handleDeleteKey(evt) ?? true);
  }

  override getViewType(): string {
    return VIEW_TYPE_PANEL;
  }

  override getDisplayText(): string {
    return PANEL_VIEW_TITLE;
  }

  override getIcon(): string {
    return "map-pinned";
  }

  override async onOpen(): Promise<void> {
    // `mythical-map-view` scopes the plugin's CSS.
    this.contentEl.addClass("mythical-map-view", "mythical-map-sidebar");
    const follow = () => this.follow();
    this.registerEvent(this.app.workspace.on("active-leaf-change", follow));
    this.registerEvent(this.app.workspace.on("file-open", follow));
    this.registerEvent(this.app.workspace.on("layout-change", follow));
    this.follow();
  }

  override async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.target = null;
    this.drop();
    this.contentEl.empty();
    this.emptyShown = false;
  }

  /** Point the panel at the most recently used map, if the most recent tab is one. */
  follow(): void {
    const view = this.app.workspace.getMostRecentLeaf()?.view;
    const next = view instanceof MapView ? view : null;
    if (next !== this.target) {
      this.unsubscribe?.();
      this.target = next;
      this.unsubscribe = next?.onViewChange(() => this.sync()) ?? null;
    }
    this.sync();
  }

  private drop(): void {
    this.built?.form.destroy();
    this.built?.panel.destroy();
    this.built = null;
  }

  /** Bring the panel in line with the target's map and selection. */
  private sync(): void {
    const view = this.target;
    const shown = view?.styledMap() ?? null;
    if (!view || !shown) {
      if (this.emptyShown) return;
      this.drop();
      this.contentEl.empty();
      this.contentEl.createDiv({ cls: "mythical-map-sidebar-empty", text: NO_MAP_TEXT });
      this.emptyShown = true;
      return;
    }
    if (this.built?.view !== view || this.built.path !== shown.path) {
      this.drop();
      this.contentEl.empty();
      this.emptyShown = false;
      this.built = this.build(view, shown.path);
    }
    const { panel, form } = this.built;
    panel.update(shown.map);
    form.update(shown.map);
    panel.setSelected(view.selectedId);
    form.setSelected(view.selectedId);
  }

  private build(view: MapView, path: string): Built {
    let collapsed = this.collapsed.get(path);
    if (!collapsed) this.collapsed.set(path, (collapsed = new Set()));
    const panel = new FeaturePanel(
      this.contentEl,
      {
        edit: (op) => view.edit(op),
        select: (id) => view.revealFeature(id),
        notify: (message) => view.notify(message),
        contextMenu: (id, event) => view.showFeatureMenu(id, event),
      },
      collapsed,
    );
    const form = new PropertiesForm(panel.el, {
      edit: (op) => view.edit(op),
      suggestIcons: (input, pick) => {
        const suggest = new IconSuggest(this.app, input, pick);
        return () => suggest.close();
      },
      chooseLink: (current, done) => new LinkSuggestModal(this.app, path, current.trim() !== "", done).open(),
    });
    return { view, path, panel, form };
  }
}

export interface PanelMemory {
  /** True once the panel has been added to the sidebar. */
  added(): boolean;
  markAdded(): Promise<void>;
}

/** Register the panel view and command; returns what map views call. */
export function registerMapPanel(plugin: Plugin, app: App, memory: PanelMemory): { opened(): void; reveal(): void } {
  plugin.registerView(VIEW_TYPE_PANEL, (leaf) => new MapPanelView(leaf));

  /** The panel's leaf, added to the right sidebar (without focus) if there is none. */
  const ensure = async (): Promise<WorkspaceLeaf | null> => {
    const existing = app.workspace.getLeavesOfType(VIEW_TYPE_PANEL)[0];
    if (existing) return existing;
    const leaf = app.workspace.getRightLeaf(false);
    await leaf?.setViewState({ type: VIEW_TYPE_PANEL, active: false });
    return leaf;
  };
  const reveal = (): void => {
    void ensure().then(async (leaf) => {
      if (!leaf) return;
      await memory.markAdded();
      await app.workspace.revealLeaf(leaf);
    });
  };
  let adding = false;
  /** The first map ever opened adds the panel; after that the user's layout decides. */
  const opened = (): void => {
    // Wait for the saved layout, which may already hold the panel.
    app.workspace.onLayoutReady(() => {
      if (adding || memory.added()) return;
      adding = true;
      void ensure()
        .then(async (leaf) => {
          if (leaf) await memory.markAdded();
        })
        .finally(() => {
          adding = false;
        });
    });
  };

  plugin.addCommand({ id: SHOW_PANEL_COMMAND_ID, name: SHOW_PANEL_TITLE, callback: reveal });
  return { opened, reveal };
}
