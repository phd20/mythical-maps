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
}

export class App {
  vault = new Vault();
  metadataCache = new MetadataCache();
  workspace = new Workspace();
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
}

export class WorkspaceLeaf {
  opened: TFile[] = [];
  constructor(public app: App = new App()) {}
  async openFile(file: TFile): Promise<void> {
    this.opened.push(file);
  }
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
  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }
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
}

export abstract class View extends Component {
  app: App;
  contentEl = new MockElement() as unknown as HTMLElement;
  constructor(public leaf: WorkspaceLeaf) {
    super();
    this.app = leaf.app;
  }
  abstract getViewType(): string;
  abstract getDisplayText(): string;
  getIcon(): string {
    return "";
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
  /** Test helper: simulate Obsidian opening `file` with contents `data`. */
  loadFile(file: TFile, data: string): void {
    this.file = file;
    this.data = data;
    this.setViewData(data, true);
  }
  abstract getViewData(): string;
  abstract setViewData(data: string, clear: boolean): void;
  abstract clear(): void;
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
