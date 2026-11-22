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

export class App {}

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
}

/** Stand-in for a container element: it only collects the Settings added to it. */
export class MockElement {
  settings: Setting[] = [];
  empty(): void {
    this.settings = [];
  }
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
