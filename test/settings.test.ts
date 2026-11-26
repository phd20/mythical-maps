import { describe, expect, it } from "vitest";
// The mock module is what vitest aliases `obsidian` to; import it directly for its test helpers.
import { App, MockElement, type MockComponent, type Plugin as MockPlugin, type Setting } from "./mocks/obsidian";
import MythicalMapsPlugin from "../src/main";
import manifest from "../manifest.json";
import { DEFAULT_SETTINGS, mergeSettings, toOverrideConfig } from "../src/obsidian/settings";
import { MythicalMapsSettingTab } from "../src/obsidian/settingsTab";
import { DEFAULT_STYLES } from "../src/core/style";
import { ICON_SHAPES, ICON_SIZES } from "../src/core/schema";

const newPlugin = () => new MythicalMapsPlugin(new App() as never, manifest);
const tabsOf = (plugin: MythicalMapsPlugin) => (plugin as unknown as MockPlugin).settingTabs;

describe("mergeSettings", () => {
  it("returns the spec defaults on a fresh install (null)", () => {
    const s = mergeSettings(null);
    expect(s).toEqual({
      mapsProperty: "maps",
      overrides: { enabled: false, iconProperty: "", colorProperty: "", shapeProperty: "" },
      defaultPinStyle: { iconGlyph: "map-pin", iconColor: "#A7A7A7", iconShape: "pin", iconSize: "medium" },
      panelAdded: false,
      settingsVersion: 1,
    });
    expect(s.defaultPinStyle).toEqual(DEFAULT_STYLES.pin);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("treats non-object input as empty", () => {
    for (const input of [undefined, 42, "x", [], true]) expect(mergeSettings(input)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns fresh objects that do not alias the defaults", () => {
    const s = mergeSettings(null);
    s.overrides.enabled = true;
    s.defaultPinStyle.iconColor = "#000000";
    expect(DEFAULT_SETTINGS.overrides.enabled).toBe(false);
    expect(DEFAULT_SETTINGS.defaultPinStyle.iconColor).toBe("#A7A7A7");
    expect(DEFAULT_STYLES.pin.iconColor).toBe("#A7A7A7");
  });

  it("deep-merges partial data over the defaults", () => {
    const s = mergeSettings({
      mapsProperty: "region-maps",
      overrides: { enabled: true, colorProperty: "faction-color" },
      defaultPinStyle: { iconShape: "shield" },
    });
    expect(s.mapsProperty).toBe("region-maps");
    expect(s.overrides).toEqual({ enabled: true, iconProperty: "", colorProperty: "faction-color", shapeProperty: "" });
    expect(s.defaultPinStyle).toEqual({ ...DEFAULT_STYLES.pin, iconShape: "shield" });
  });

  it("keeps every valid stored field", () => {
    const full = {
      mapsProperty: "atlas",
      overrides: { enabled: true, iconProperty: "i", colorProperty: "c", shapeProperty: "s" },
      defaultPinStyle: { iconGlyph: "castle", iconColor: "#aa2233", iconShape: "flag", iconSize: "small" },
      panelAdded: true,
      settingsVersion: 1,
    };
    expect(mergeSettings(full)).toEqual(full);
  });

  it("falls back per field on wrong types and invalid values", () => {
    const s = mergeSettings({
      mapsProperty: 7,
      overrides: { enabled: "yes", iconProperty: 3, colorProperty: null, shapeProperty: ["x"] },
      defaultPinStyle: { iconGlyph: 1, iconColor: "not-a-colour", iconShape: "hexagon", iconSize: "huge" },
      settingsVersion: 99,
    });
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back when nested groups are the wrong type", () => {
    expect(mergeSettings({ overrides: "on", defaultPinStyle: [1, 2] })).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects an empty maps property or glyph, and short hex colours", () => {
    const s = mergeSettings({ mapsProperty: "  ", defaultPinStyle: { iconGlyph: "", iconColor: "#abc" } });
    expect(s.mapsProperty).toBe("maps");
    expect(s.defaultPinStyle.iconGlyph).toBe("map-pin");
    expect(s.defaultPinStyle.iconColor).toBe("#A7A7A7");
  });

  it("drops unknown keys at every level", () => {
    const s = mergeSettings({
      bogus: 1,
      features: [{ id: "x" }],
      overrides: { enabled: true, extra: "x" },
      defaultPinStyle: { iconColor: "#112233", glow: true },
    }) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(s).sort()).toEqual(["defaultPinStyle", "mapsProperty", "overrides", "panelAdded", "settingsVersion"]);
    expect(Object.keys(s.overrides!).sort()).toEqual(["colorProperty", "enabled", "iconProperty", "shapeProperty"]);
    expect(Object.keys(s.defaultPinStyle!).sort()).toEqual(["iconColor", "iconGlyph", "iconShape", "iconSize"]);
  });
});

describe("toOverrideConfig", () => {
  it("maps empty names to undefined", () => {
    expect(toOverrideConfig(DEFAULT_SETTINGS)).toEqual({
      enabled: false,
      iconProperty: undefined,
      colorProperty: undefined,
      shapeProperty: undefined,
    });
  });

  it("passes configured names through, trimming whitespace-only to undefined", () => {
    const s = mergeSettings({ overrides: { enabled: true, iconProperty: "map-icon", colorProperty: "faction-color", shapeProperty: "   " } });
    expect(toOverrideConfig(s)).toEqual({
      enabled: true,
      iconProperty: "map-icon",
      colorProperty: "faction-color",
      shapeProperty: undefined,
    });
  });
});

describe("plugin settings persistence", () => {
  it("loads defaults when data.json is empty and registers the tab", async () => {
    const plugin = newPlugin();
    await plugin.onload();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(tabsOf(plugin)).toHaveLength(1);
    expect(tabsOf(plugin)[0]).toBeInstanceOf(MythicalMapsSettingTab);
  });

  it("round-trips load → edit → save → load", async () => {
    const plugin = newPlugin();
    await plugin.saveData({ mapsProperty: "region-maps", junk: true });
    await plugin.loadSettings();
    expect(plugin.settings.mapsProperty).toBe("region-maps");

    plugin.settings.overrides.enabled = true;
    plugin.settings.defaultPinStyle.iconSize = "small";
    await plugin.saveSettings();

    const saved = await plugin.loadData();
    expect(saved).toEqual({ ...DEFAULT_SETTINGS, mapsProperty: "region-maps", overrides: { ...DEFAULT_SETTINGS.overrides, enabled: true }, defaultPinStyle: { ...DEFAULT_SETTINGS.defaultPinStyle, iconSize: "small" } });

    plugin.settings = mergeSettings(null);
    await plugin.loadSettings();
    expect(plugin.settings).toEqual(saved);
  });
});

describe("MythicalMapsSettingTab", () => {
  const setup = async () => {
    const plugin = newPlugin();
    await plugin.onload();
    const tab = tabsOf(plugin)[0] as unknown as MythicalMapsSettingTab;
    tab.display();
    const settings = (tab.containerEl as unknown as MockElement).settings;
    const control = (name: string): MockComponent<unknown> => {
      const row = settings.find((s: Setting) => s.name === name);
      if (!row?.components[0]) throw new Error(`no control for ${name}`);
      return row.components[0];
    };
    return { plugin, settings, control };
  };

  it("renders a control for every field, with current values", async () => {
    const { settings, control } = await setup();
    const named = settings.filter((s) => !s.heading).map((s) => s.name);
    expect(named).toEqual([
      "Maps property",
      "Enable frontmatter style overrides",
      "Icon property",
      "Colour property",
      "Shape property",
      "Glyph",
      "Colour",
      "Shape",
      "Size",
    ]);
    expect(control("Maps property").value).toBe("maps");
    expect(control("Enable frontmatter style overrides").kind).toBe("toggle");
    expect(control("Colour").kind).toBe("color");
    expect(control("Colour").value).toBe("#A7A7A7");
    expect(Object.keys(control("Shape").options)).toEqual([...ICON_SHAPES]);
    expect(Object.keys(control("Size").options)).toEqual([...ICON_SIZES]);
    const toggleRow = settings.find((s) => s.name === "Enable frontmatter style overrides");
    expect(toggleRow?.desc).toMatch(/optional/i);
    expect(toggleRow?.desc).toMatch(/never written to map files/);
  });

  it("saves each change immediately", async () => {
    const { plugin, control } = await setup();
    await control("Maps property").change("region-maps");
    await control("Enable frontmatter style overrides").change(true);
    await control("Icon property").change(" map-icon ");
    await control("Colour property").change("faction-color");
    await control("Shape property").change("map-shape");
    await control("Glyph").change("castle");
    await control("Colour").change("#aa2233");
    await control("Shape").change("diamond");
    await control("Size").change("small");

    expect(await plugin.loadData()).toEqual({
      mapsProperty: "region-maps",
      overrides: { enabled: true, iconProperty: "map-icon", colorProperty: "faction-color", shapeProperty: "map-shape" },
      defaultPinStyle: { iconGlyph: "castle", iconColor: "#AA2233", iconShape: "diamond", iconSize: "small" },
      panelAdded: false, settingsVersion: 1,
    });
  });

  it("restores defaults for an emptied maps property or glyph and ignores invalid choices", async () => {
    const { plugin, control } = await setup();
    await control("Maps property").change("");
    await control("Glyph").change("   ");
    await control("Colour").change("red");
    await control("Shape").change("hexagon");
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
  });
});
