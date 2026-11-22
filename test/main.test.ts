import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";

describe("MythicalMapsPlugin", () => {
  it("loads and unloads cleanly", async () => {
    const plugin = new MythicalMapsPlugin(new App() as never, manifest);
    await plugin.onload();
    expect(() => plugin.onunload()).not.toThrow();
  });

  it("wires the vault map index and subscribes to vault events once the layout is ready", async () => {
    const app = new App();
    const plugin = new MythicalMapsPlugin(app as never, manifest);
    await plugin.onload();
    expect(plugin.mapIndex).toBeDefined();
    expect((plugin as unknown as { events: unknown[] }).events).toHaveLength(0);
    // tsc checks tests against the real obsidian types; runLayoutReady exists only on the mock.
    (app.workspace as unknown as { runLayoutReady(): void }).runLayoutReady();
    await plugin.mapIndex.whenIdle();
    const names = (plugin as unknown as { events: { name: string }[] }).events.map((e) => e.name).sort();
    expect(names).toEqual(["create", "delete", "modify", "rename"]);
  });

  it("has the expected manifest id and is not desktop-only", () => {
    expect(manifest.id).toBe("mythical-maps");
    expect(manifest.isDesktopOnly).toBe(false);
  });
});
