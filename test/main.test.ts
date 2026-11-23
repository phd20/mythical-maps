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
    // tsc checks tests against the real obsidian types; `events`, `owner` and runLayoutReady exist only on the mock.
    const events = (plugin as unknown as { events: { name: string; owner: unknown }[] }).events;
    const vaultEventNames = () => events.filter((e) => e.owner === app.vault).map((e) => e.name).sort();
    expect(vaultEventNames()).toEqual([]);
    (app.workspace as unknown as { runLayoutReady(): void }).runLayoutReady();
    await plugin.mapIndex.whenIdle();
    expect(vaultEventNames()).toEqual(["create", "delete", "delete", "modify", "rename", "rename"]);
    // The other events are the style-override metadata listener (bead 7.1) and the "New map from image" file-menu item, registered at load.
    // Bead 6.6 adds a vault delete and rename listener (the extra entries above) and the metadata changed/deleted listeners (below, after layout ready).
    expect(events.filter((e) => e.owner !== app.vault).map((e) => [e.owner === app.workspace ? "workspace" : e.owner === app.metadataCache ? "metadataCache" : "other", e.name])).toEqual([
      ["metadataCache", "changed"],
      ["metadataCache", "changed"], // bead 6.3: drill-down listener
      ["workspace", "file-menu"],
      ["metadataCache", "changed"], // bead 6.6: broken-link badge refresh
      ["metadataCache", "deleted"],
    ]);
  });

  it("has the expected manifest id and is not desktop-only", () => {
    expect(manifest.id).toBe("mythical-maps");
    expect(manifest.isDesktopOnly).toBe(false);
  });
});
