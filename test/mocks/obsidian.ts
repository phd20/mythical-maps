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
    this.data = data;
  }
}

export class Notice {
  constructor(public message: string) {}
}
