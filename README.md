# Mythical Maps

Interactive tabletop RPG maps inside [Obsidian](https://obsidian.md). Drop pins, labels, regions and paths on a map image, link pins to your notes, and open city maps from a world map.

> [!WARNING]
> **Beta software (version 0.1.1).** Expect bugs and rough edges, and expect things to change, possibly including the `.map` file format. **Back up your vault before using it**, or try it in a test vault first. It is provided as is, without warranty. Please [report problems](https://github.com/PhD20/mythical-maps/issues).

## Why

- **Your notes stay clean.** A map is its own `.map` file. There is no code-block syntax, and no map data is ever written into your notes.
- **Linked to your world.** Hover a pin to preview its note; click it to open the note.
- **Plain files.** A `.map` file is readable JSON that works with git and sync tools.

## Requirements

- Obsidian 1.5.0 or newer on desktop. Mobile is untested.
- A map image: png, jpg, jpeg, webp, gif, bmp, avif or svg. Images up to about 8000 pixels wide are the target.

## Install

Mythical Maps is not in Obsidian's community plugin directory, so install it by hand:

1. Open the [latest release](https://github.com/PhD20/mythical-maps/releases) and download `main.js`, `manifest.json` and `styles.css`.
2. In your vault folder, create `.obsidian/plugins/mythical-maps/` and put the three files in it. `.obsidian` is a hidden folder (on macOS, press Cmd+Shift+. in Finder to show it).
3. In Obsidian, open **Settings → Community plugins**. Turn off Restricted mode if it is on, refresh the list, and enable **Mythical Maps**.

To update, replace the three files and reload Obsidian.

## Make your first map

1. **Add an image** to your vault.
2. **Create the map.** Right-click the image in the file explorer and choose **New map from image**. A `.map` file appears next to the image and opens.
3. **Look around.** Drag to pan; scroll or pinch to zoom.
4. **Add a pin.** Choose **Pin** in the toolbar and click the map. **Label**, **Region** and **Path** work the same way; for a region or path, click each corner, then click the first or last point to finish.
5. **Name and link it.** Choose **Select** and click the pin. The **Map features** tab in the right sidebar shows its **Properties**; use **Choose…** to pick a note; an unnamed pin takes the note's name. Type in **Icon** to search icons, and use the swatch beside a colour to pick it.
6. **Use the map.** Click the lock icon at the top of the tab. A locked map can't be changed by accident, and **clicking a pin now opens its note**.

> [!TIP]
> If clicking a pin only selects it, the map is unlocked. Lock it to open notes by clicking. Every map opens unlocked.

## Everyday controls

| To do this | Do this |
| --- | --- |
| Move a pin or label | Unlocked, in Select mode, drag it |
| Reshape a region or path | Unlocked, in Select mode, drag its points |
| Add a pin from any mode | Shift-click, or right-click the map and choose **Add pin here** |
| Delete the selected item | Delete or Backspace |
| Undo / redo | Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z |
| Organise items | In the **Features** panel, create folders, drag items into them, and use the eye icon to hide them |
| Find an item | Click it in the **Features** panel to centre the map on it |
| Reopen the map panel | The panel icon at the top of the map tab, or run **Show map panel** |
| Save the opening view | Run **Set current view as default** |
| Show the whole map | **Fit map to view** in the toolbar |

## Link maps together

Give a note a `maps` property that lists `.map` files:

```yaml
---
maps: ["[[Westmarch.map]]", "[[Westmarch Sewers.map]]"]
---
```

A pin linked to that note shows a map badge. Hover or right-click the pin and choose **Open map**.

## Good to know

- Renaming or moving notes and images **inside Obsidian** updates your maps. Renaming them outside Obsidian leaves a broken-link badge; run **Find broken pins** to repair them.
- Pin links don't appear in Obsidian's backlinks or graph.
- Large images are held in memory while their map is open: about 270 MB for a 6144 × 8192 image, so several large maps add up. They appear a moment after the pins.
- Maps can't be embedded in notes (`![[X.map]]` does nothing useful yet).
- There is no fog of war, measuring tool, grid or image overlay.
- The `.map` extension is also used by JavaScript source maps. If your vault contains code, those files open as "not a Mythical map" and are left untouched.

## Learn more

- [Reference](docs/reference.md): features, settings, style overrides, the file format and all known limits
- [Development](docs/development.md): build from source and run the tests

## Credits and license

[MIT](LICENSE) © 2026 PhD20. Bundles Leaflet, Leaflet-Geoman, Zod, fractional-indexing and their dependencies; see [third-party notices](THIRD-PARTY-NOTICES.md). The map coordinate system matches [LegendKeeper](https://www.legendkeeper.com/)'s as a design reference. This project is not affiliated with LegendKeeper or Obsidian.
