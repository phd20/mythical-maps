/**
 * Icon suggestions under the pin's Icon field: each matching Lucide (or plugin
 * registered) icon with its preview. Typing a name by hand stays possible.
 * The popup is outside the view, so each item carries `mythical-map-view` to
 * pick up the plugin's scoped CSS (an icon and name side by side).
 */
import { AbstractInputSuggest, getIconIds, setIcon, type App } from "obsidian";
import { searchIcons } from "../core/iconSearch";

export class IconSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    input: HTMLInputElement,
    private readonly onPick: (name: string) => void,
  ) {
    super(app, input);
  }

  override getSuggestions(query: string): string[] {
    return searchIcons(getIconIds(), query);
  }

  override renderSuggestion(name: string, el: HTMLElement): void {
    el.addClass("mythical-map-view", "mythical-map-icon-suggestion");
    setIcon(el.createSpan({ cls: "mythical-map-icon-suggestion-icon" }), name);
    el.createSpan({ text: name });
  }

  override selectSuggestion(name: string, _evt: MouseEvent | KeyboardEvent): void {
    this.setValue(name);
    this.close();
    this.onPick(name);
  }
}
