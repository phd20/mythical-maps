/**
 * Hand-written mock of the parts of the `obsidian` API the plugin uses.
 * vitest aliases `obsidian` to this file (see vitest.config.ts).
 * Extend it only as far as a test needs; keep behaviour minimal and explicit.
 */

export class Component {
  private cleanups: Array<() => void> = [];
  load(): void {
    this.onload();
  }
  onload(): void {}
  unload(): void {
    for (const c of this.cleanups.splice(0)) c();
    this.onunload();
  }
  onunload(): void {}
  register(cb: () => void): void {
    this.cleanups.push(cb);
  }
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  description: string;
  author: string;
  isDesktopOnly?: boolean;
}

export interface EventRef {
  name: string;
  /** The emitter the handler was registered on (vault, workspace, …). */
  owner: unknown;
}

/** Minimal event emitter, shaped like Obsidian's Events.on/trigger. */
class MockEvents {
  handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {};
  on(name: string, cb: (...args: never[]) => unknown): EventRef {
    (this.handlers[name] ??= []).push(cb as (...args: unknown[]) => unknown);
    return { name, owner: this };
  }
  trigger(name: string, ...args: unknown[]): void {
    for (const cb of this.handlers[name] ?? []) cb(...args);
  }
}

/** Records every write so tests can assert that none happened. An empty vault by default. */
export class Vault extends MockEvents {
  modified: Array<{ file: TFile; data: string }> = [];
  async modify(file: TFile, data: string): Promise<void> {
    this.modified.push({ file, data });
  }
  getFiles(): TFile[] {
    return [];
  }
  getFileByPath(_path: string): TFile | null {
    return null;
  }
  async cachedRead(_file: TFile): Promise<string> {
    return "";
  }
  /** Files made with `create`; `getAbstractFileByPath` finds them. */
  created: Array<{ file: TFile; data: string }> = [];
  async create(path: string, data: string): Promise<TFile> {
    if (this.getAbstractFileByPath(path)) throw new Error(`File already exists: ${path}`);
    const file = new TFile(path);
    this.created.push({ file, data });
    return file;
  }
  getAbstractFileByPath(path: string): TFile | null {
    return this.created.find((c) => c.file.path === path)?.file ?? null;
  }
  getResourcePath(file: TFile): string {
    return `app://local/${file.path}`;
  }
  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const data = fn("");
    this.modified.push({ file, data });
    return data;
  }
}

export class MetadataCache extends MockEvents {
  getFirstLinkpathDest(_linkpath: string, _sourcePath: string): TFile | null {
    return null;
  }
  fileToLinktext(file: TFile, _sourcePath: string, omitMdExtension = true): string {
    return omitMdExtension && file.extension === "md" ? file.path.slice(0, -3) : file.path;
  }
  /** No cached metadata by default; tests replace this per instance. */
  getFileCache(_file: TFile): { frontmatter?: Record<string, unknown> } | null {
    return null;
  }
}

export class Workspace extends MockEvents {
  layoutReadyCallbacks: Array<() => unknown> = [];
  /** Callbacks are queued; tests call runLayoutReady() to simulate Obsidian finishing its load. */
  onLayoutReady(cb: () => unknown): void {
    this.layoutReadyCallbacks.push(cb);
  }
  runLayoutReady(): void {
    for (const cb of this.layoutReadyCallbacks.splice(0)) cb();
  }
  activeFile: TFile | null = null;
  getActiveFile(): TFile | null {
    return this.activeFile;
  }
  /** Every leaf handed out by `getLeaf`, so tests can see what was opened. */
  leaves: WorkspaceLeaf[] = [];
  getLeaf(_newLeaf?: unknown): WorkspaceLeaf {
    const leaf = new WorkspaceLeaf();
    this.leaves.push(leaf);
    return leaf;
  }
  /** The view in the active leaf; tests set it directly. */
  activeView: unknown = null;
  getActiveViewOfType<T>(type: abstract new (...args: never[]) => T): T | null {
    return this.activeView instanceof type ? this.activeView : null;
  }
  /** Leaves (from `leaves`) whose `view` has the given type. */
  getLeavesOfType(type: string): WorkspaceLeaf[] {
    return this.leaves.filter((leaf) => leaf.view?.getViewType() === type);
  }
  /** Bead 6.2: every `openLinkText` call, in order. */
  openedLinks: Array<{ linktext: string; sourcePath: string; newLeaf: unknown }> = [];
  openLinkText(linktext: string, sourcePath: string, newLeaf?: unknown): Promise<void> {
    this.openedLinks.push({ linktext, sourcePath, newLeaf });
    return Promise.resolve();
  }
}

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";

/** Records key handlers; tests fire them with `trigger`. No parent fallback. */
export class Scope {
  handlers: Array<{ modifiers: Modifier[]; key: string | null; func: (evt: unknown, ctx: unknown) => unknown }> = [];
  constructor(public parent?: Scope) {}
  register(modifiers: Modifier[] | null, key: string | null, func: (evt: never, ctx: never) => unknown): unknown {
    const handler = { modifiers: modifiers ?? [], key, func: func as (evt: unknown, ctx: unknown) => unknown };
    this.handlers.push(handler);
    return handler;
  }
  /** Test helper: run the handler registered for exactly these modifiers and key; returns its result. */
  trigger(modifiers: Modifier[], key: string, evt: unknown = {}): unknown {
    const same = (a: Modifier[]) => a.length === modifiers.length && a.every((m) => modifiers.includes(m));
    const handler = this.handlers.find((h) => same(h.modifiers) && h.key?.toLowerCase() === key.toLowerCase());
    if (!handler) throw new Error(`No handler for ${modifiers.join("+")}+${key}`);
    return handler.func(evt, {});
  }
}

/** Shaped like Obsidian's `Tasks` passed to the workspace "quit" event. */
export class Tasks {
  promises: Array<Promise<unknown>> = [];
  add(callback: () => Promise<unknown>): void {
    this.promises.push(callback());
  }
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache();
  workspace = new Workspace();
  scope = new Scope();
}

/** Records the icon on a MockElement. */
export function setIcon(el: HTMLElement, name: string): void {
  (el as unknown as MockElement).icon = name;
}

export class TFile {
  basename: string;
  extension: string;
  name: string;
  constructor(public path: string) {
    this.name = path.split("/").pop() ?? path;
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
  }
}

export class Plugin extends Component {
  app: App;
  manifest: PluginManifest;
  private data: unknown = null;

  constructor(app: App, manifest: PluginManifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }

  async loadData(): Promise<unknown> {
    return this.data;
  }

  async saveData(data: unknown): Promise<void> {
    // Round-trip through JSON like data.json does, so tests can't share references.
    this.data = data === undefined ? undefined : JSON.parse(JSON.stringify(data));
  }

  settingTabs: PluginSettingTab[] = [];
  addSettingTab(tab: PluginSettingTab): void {
    this.settingTabs.push(tab);
  }

  views: Record<string, (leaf: WorkspaceLeaf) => View> = {};
  registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
    this.views[type] = factory;
  }

  extensions: Record<string, string> = {};
  registerExtensions(extensions: string[], viewType: string): void {
    for (const ext of extensions) this.extensions[ext] = viewType;
  }

  commands: Command[] = [];
  addCommand(command: Command): Command {
    this.commands.push(command);
    return command;
  }

  events: EventRef[] = [];
  registerEvent(ref: EventRef): void {
    this.events.push(ref);
  }

  /** Bead 6.2: hover link sources by id. */
  hoverLinkSources: Record<string, HoverLinkSource> = {};
  registerHoverLinkSource(id: string, info: HoverLinkSource): void {
    this.hoverLinkSources[id] = info;
  }
}

export class WorkspaceLeaf {
  opened: TFile[] = [];
  constructor(public app: App = new App()) {}
  async openFile(file: TFile): Promise<void> {
    this.opened.push(file);
  }
  /** The view shown in this leaf; tests set it directly. */
  view: View | null = null;
}

export interface Command {
  id: string;
  name: string;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
}

export class MenuItem {
  title = "";
  icon: string | null = null;
  clickHandler: ((evt: unknown) => unknown) | undefined;
  setTitle(title: string): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }
  onClick(cb: (evt: unknown) => unknown): this {
    this.clickHandler = cb;
    return this;
  }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    this.items.push(item);
    cb(item);
    return this;
  }
  /** Set by `showAtMouseEvent` (bead 5.2). */
  shownAt: unknown = null;
  showAtMouseEvent(evt: unknown): this {
    this.shownAt = evt;
    return this;
  }
}

interface MockElementInfo {
  text?: string;
  cls?: string | string[];
}

/**
 * Stand-in for a container element. It collects the Settings added to it and
 * supports Obsidian's DOM helpers (createEl/createDiv/createSpan/empty/addClass),
 * recording tag, classes and text so tests can inspect what a view rendered.
 */
export class MockElement {
  settings: Setting[] = [];
  children: MockElement[] = [];
  classes = new Set<string>();
  text = "";
  constructor(public tag = "div") {}
  empty(): void {
    this.settings = [];
    this.children = [];
    this.text = "";
  }
  addClass(...cls: string[]): void {
    for (const c of cls) this.classes.add(c);
  }
  remove(): void {}
  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }
  toggleClass(cls: string, value: boolean): void {
    if (value) this.classes.add(cls);
    else this.classes.delete(cls);
  }
  attributes: Record<string, string> = {};
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  /** Set by the mock `setIcon`. */
  icon: string | null = null;
  createEl(tag: string, o?: MockElementInfo | string, callback?: (el: MockElement) => void): MockElement {
    const el = new MockElement(tag);
    const info = typeof o === "string" ? { cls: o } : (o ?? {});
    if (info.cls) el.addClass(...(Array.isArray(info.cls) ? info.cls : info.cls.split(" ")));
    if (info.text !== undefined) el.text = info.text;
    this.children.push(el);
    callback?.(el);
    return el;
  }
  createDiv(o?: MockElementInfo | string, callback?: (el: MockElement) => void): MockElement {
    return this.createEl("div", o, callback);
  }
  createSpan(o?: MockElementInfo | string, callback?: (el: MockElement) => void): MockElement {
    return this.createEl("span", o, callback);
  }
  /** All text in this element and its descendants, depth first, space-joined. */
  get textContent(): string {
    return [this.text, ...this.children.map((c) => c.textContent)].filter(Boolean).join(" ");
  }
  /** Descendants, depth first, that match `pred`. */
  findAll(pred: (el: MockElement) => boolean): MockElement[] {
    return this.children.flatMap((c) => [...(pred(c) ? [c] : []), ...c.findAll(pred)]);
  }
  listeners: Record<string, Array<(evt: unknown) => unknown>> = {};
  addEventListener(type: string, cb: (evt: unknown) => unknown): void {
    (this.listeners[type] ??= []).push(cb);
  }
  /** Test helper: fire the element's click listeners. */
  click(): void {
    for (const cb of this.listeners.click ?? []) cb({ type: "click" });
  }
}

export abstract class View extends Component {
  app: App;
  contentEl = new MockElement() as unknown as HTMLElement;
  scope: Scope | null = null;
  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.app;
  }
  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getIcon(): string {
    return "";
  }
  onPaneMenu(_menu: Menu, _source: string): void {}
  async onClose(): Promise<void> {}
  /** Header actions added with `addAction`, in order. */
  actions: Array<{ icon: string; title: string; callback: (evt: unknown) => unknown; el: MockElement }> = [];
  addAction(icon: string, title: string, callback: (evt: unknown) => unknown): HTMLElement {
    const el = new MockElement("a");
    el.icon = icon;
    el.attributes["aria-label"] = title;
    this.actions.push({ icon, title, callback, el });
    return el as unknown as HTMLElement;
  }
  /** Events registered by this view; detached on unload like Obsidian does. */
  events: EventRef[] = [];
  registerEvent(ref: EventRef): void {
    this.events.push(ref);
    this.register(() => {
      const owner = ref.owner as MockEvents;
      // Drop every handler for the event name the view registered (enough for tests).
      if (owner.handlers) delete owner.handlers[ref.name];
    });
  }
}

/**
 * Minimal TextFileView: `requestSave` saves immediately (no debounce), and
 * `save()` writes `getViewData()` through `vault.modify`, as Obsidian does.
 */
export abstract class TextFileView extends View {
  data = "";
  file: TFile | null = null;
  requestSave: () => void = () => {
    void this.save();
  };
  async save(_clear?: boolean): Promise<void> {
    if (!this.file) return;
    this.data = this.getViewData();
    await this.app.vault.modify(this.file, this.data);
  }
  /** Obsidian's base flushes via `save()` and clears; this mock only records the call. */
  unloadedFiles: TFile[] = [];
  async onUnloadFile(file: TFile): Promise<void> {
    this.unloadedFiles.push(file);
  }
  /** Test helper: simulate Obsidian opening `file` with contents `data`. */
  loadFile(file: TFile, data: string): void {
    this.file = file;
    this.data = data;
    this.setViewData(data, true);
  }
  /** Test helper: simulate Obsidian reloading the open file after it changed on disk. */
  modifyExternally(data: string): void {
    if (data === this.data) return;
    this.data = data;
    this.setViewData(data, false);
  }
  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void;
  abstract clear(): void;
}

/** Suggestions under an input; tests call `getSuggestions` / `selectSuggestion` directly. */
export abstract class AbstractInputSuggest<T> {
  closed = false;
  constructor(
    public app: App,
    public inputEl: HTMLInputElement,
  ) {}
  setValue(value: string): void {
    this.inputEl.value = value;
  }
  close(): void {
    this.closed = true;
  }
  abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void;
}

export function getIconIds(): string[] {
  return ["lucide-castle", "lucide-map-pin"];
}

export abstract class PluginSettingTab {
  containerEl = new MockElement() as unknown as HTMLElement;
  constructor(
    public app: App,
    public plugin: Plugin,
  ) {}
  abstract display(): void;
  hide(): void {}
}

/** A value component (text, toggle, dropdown, colour picker): stores its value and change handler. */
export class MockComponent<T = unknown> {
  value: T | undefined;
  placeholder = "";
  options: Record<string, string> = {};
  changeHandler: ((value: T) => unknown) | undefined;
  constructor(public kind: string) {}
  setValue(value: T): this {
    this.value = value;
    return this;
  }
  getValue(): T | undefined {
    return this.value;
  }
  setPlaceholder(placeholder: string): this {
    this.placeholder = placeholder;
    return this;
  }
  addOption(value: string, display: string): this {
    this.options[value] = display;
    return this;
  }
  onChange(cb: (value: T) => unknown): this {
    this.changeHandler = cb;
    return this;
  }
  /** Test helper: simulate the user changing the value. */
  async change(value: T): Promise<void> {
    this.value = value;
    await this.changeHandler?.(value);
  }
}

export class Setting {
  name = "";
  desc = "";
  heading = false;
  components: MockComponent[] = [];
  constructor(containerEl: HTMLElement) {
    if (containerEl instanceof MockElement) containerEl.settings.push(this);
  }
  setName(name: string): this {
    this.name = name;
    return this;
  }
  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }
  setHeading(): this {
    this.heading = true;
    return this;
  }
  private add(kind: string, cb: (component: never) => unknown): this {
    const component = new MockComponent(kind);
    this.components.push(component);
    cb(component as never);
    return this;
  }
  addText(cb: (component: never) => unknown): this {
    return this.add("text", cb);
  }
  addToggle(cb: (component: never) => unknown): this {
    return this.add("toggle", cb);
  }
  addDropdown(cb: (component: never) => unknown): this {
    return this.add("dropdown", cb);
  }
  addColorPicker(cb: (component: never) => unknown): this {
    return this.add("color", cb);
  }
}

export class Notice {
  constructor(public message: string) {}
}

export class Modal {
  /** Every modal opened, so tests can find and drive it. */
  static opened: Modal[] = [];
  isOpen = false;
  contentEl = new MockElement();
  constructor(public app: App) {}
  /** Subclasses override, as in Obsidian. */
  onOpen(): void {}
  onClose(): void {}
  open(): void {
    this.isOpen = true;
    Modal.opened.push(this);
    this.onOpen();
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.onClose();
  }
}

export abstract class FuzzySuggestModal<T> extends Modal {
  placeholder = "";
  setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder;
  }
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt: unknown): void;
  /** Test helper: simulate the user picking `item` (Obsidian closes, then calls onChooseItem). */
  choose(item: T): void {
    this.close();
    this.onChooseItem(item, {});
  }
}

// --- Bead 6.2: hover link sources, openLinkText and Keymap ---

export interface HoverLinkSource {
  display: string;
  defaultMod: boolean;
}

/** Obsidian's modifier semantics: middle click or Mod → tab, Mod+Alt → split, Mod+Alt+Shift → window. */
export class Keymap {
  static isModEvent(
    evt?: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; button?: number } | null,
  ): string | boolean {
    if (!evt) return false;
    if (evt.button === 1) return "tab";
    if (!(evt.ctrlKey || evt.metaKey)) return false;
    if (evt.altKey) return evt.shiftKey ? "window" : "split";
    return "tab";
  }
}

export interface HoverPopover {
  hoverEl: unknown;
}
