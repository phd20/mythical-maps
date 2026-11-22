import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import { ICON_SHAPES, ICON_SIZES } from "../core/schema";
import { isValidHexColor } from "../core/style";
import { DEFAULT_SETTINGS, isIconShape, isIconSize, type MythicalMapsSettings } from "./settings";

/** What the tab needs from the plugin: its settings and a way to persist them. */
export interface SettingsHost extends Plugin {
  settings: MythicalMapsSettings;
  saveSettings(): Promise<void>;
}

/** Settings tab (spec plugin-settings "Settings tab"). Every change saves immediately. */
export class MythicalMapsSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly host: SettingsHost,
  ) {
    super(app, host);
  }

  private save(): Promise<void> {
    return this.host.saveSettings();
  }

  override display(): void {
    const { containerEl } = this;
    const s = this.host.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Maps property")
      .setDesc(`Frontmatter property on a note that lists its maps (default "${DEFAULT_SETTINGS.mapsProperty}").`)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.mapsProperty)
          .setValue(s.mapsProperty)
          .onChange(async (value) => {
            s.mapsProperty = value.trim() || DEFAULT_SETTINGS.mapsProperty;
            await this.save();
          }),
      );

    new Setting(containerEl).setName("Frontmatter style overrides").setHeading();

    new Setting(containerEl)
      .setName("Enable frontmatter style overrides")
      .setDesc(
        "Optional. Linked pins may take their icon, colour or shape from the linked note's frontmatter. " +
          "Overrides only change how pins are drawn and are never written to map files.",
      )
      .addToggle((toggle) =>
        toggle.setValue(s.overrides.enabled).onChange(async (value) => {
          s.overrides.enabled = value;
          await this.save();
        }),
      );

    const overrideName = (name: string, key: "iconProperty" | "colorProperty" | "shapeProperty", placeholder: string) =>
      new Setting(containerEl)
        .setName(name)
        .setDesc("Frontmatter property name. Leave empty to disable this override.")
        .addText((text) =>
          text
            .setPlaceholder(placeholder)
            .setValue(s.overrides[key])
            .onChange(async (value) => {
              s.overrides[key] = value.trim();
              await this.save();
            }),
        );
    overrideName("Icon property", "iconProperty", "map-icon");
    overrideName("Colour property", "colorProperty", "map-color");
    overrideName("Shape property", "shapeProperty", "map-shape");

    new Setting(containerEl).setName("Default pin style").setHeading();

    new Setting(containerEl)
      .setName("Glyph")
      .setDesc("Lucide icon name used when a pin stores none.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultPinStyle.iconGlyph)
          .setValue(s.defaultPinStyle.iconGlyph)
          .onChange(async (value) => {
            s.defaultPinStyle.iconGlyph = value.trim() || DEFAULT_SETTINGS.defaultPinStyle.iconGlyph;
            await this.save();
          }),
      );

    new Setting(containerEl)
      .setName("Colour")
      .setDesc("Pin colour (#RRGGBB).")
      .addColorPicker((picker) =>
        picker.setValue(s.defaultPinStyle.iconColor).onChange(async (value) => {
          if (!isValidHexColor(value)) return;
          s.defaultPinStyle.iconColor = value.toUpperCase();
          await this.save();
        }),
      );

    new Setting(containerEl).setName("Shape").addDropdown((dropdown) => {
      for (const shape of ICON_SHAPES) dropdown.addOption(shape, shape);
      dropdown.setValue(s.defaultPinStyle.iconShape).onChange(async (value) => {
        if (!isIconShape(value)) return;
        s.defaultPinStyle.iconShape = value;
        await this.save();
      });
    });

    new Setting(containerEl).setName("Size").addDropdown((dropdown) => {
      for (const size of ICON_SIZES) dropdown.addOption(size, size);
      dropdown.setValue(s.defaultPinStyle.iconSize).onChange(async (value) => {
        if (!isIconSize(value)) return;
        s.defaultPinStyle.iconSize = value;
        await this.save();
      });
    });
  }
}
