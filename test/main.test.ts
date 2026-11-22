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

  it("has the expected manifest id and is not desktop-only", () => {
    expect(manifest.id).toBe("mythical-maps");
    expect(manifest.isDesktopOnly).toBe(false);
  });
});
