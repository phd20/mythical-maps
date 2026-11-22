# Mythical Maps test vault

Manual-test vault for the plugin (design D11).

## Setup

From the repository root:

1. `npm install`
2. `npm run fixtures` writes the fixture images `Maps/fixture-4k.png` (4096×3072) and `Maps/fixture-8k.png` (8192×6144). They are gitignored, so run this once after cloning.
3. `npm run dev` watches and builds the plugin into `test-vault/.obsidian/plugins/mythical-maps/`. Leave it running.
4. In Obsidian, choose **Open folder as vault** and pick this `test-vault/` folder.
5. If asked, choose **Trust author and enable plugins**. `.obsidian/community-plugins.json` already lists `mythical-maps`; otherwise turn off Restricted mode and enable it under Settings → Community plugins.

To reload after each rebuild without restarting Obsidian, install the Hot-Reload community plugin; the dev build writes its `.hotreload` marker.

## Fixtures

| File | Purpose |
| --- | --- |
| `Maps/all-types.map` | Valid map on the 4k image: a folder with a pin, a top-level pin linked to `Westmarch`, a label with `visibilityRange` [0.5, 1], a region, a path, and a hidden folder with a child pin |
| `Maps/big-8k.map` | Valid map on the 8k image, with pins at known pixel positions (the names give the pixels) |
| `Maps/invalid-json.map` | Malformed JSON: opens the error view and is never overwritten |
| `Maps/not-mythical.map` | Valid JSON without `"type": "mythical-map"`: "not a Mythical map" |
| `Maps/future-version.map` | `version` 99: "upgrade the plugin" |
| `Maps/broken-links.map` | Pins linking to notes that do not exist (plus one that resolves) |
| `Maps/missing-image.map` | `image.path` points to a file that does not exist |
| `Places/Westmarch.md` | Has a `maps:` list linking two maps (drill-down) |
| `Places/Rusty Flagon.md` | Plain linked note |
| `Places/The Keep.md` | Has `faction-color: "#AA2233"` for style-override testing |

Coordinates use the LegendKeeper frame (design D3): `z = max(0, ceil(log2(max(w, h) / 256)))` and `pos = [-y / 2^z, x / 2^z]`. For 4096×3072, z = 4; for 8192×6144, z = 5. Both images span `[[-192, 0], [0, 256]]`.

The images have a thin grid line every 256 px, a thicker dark line every 1024 px and a magenta border, over a colour gradient, so pan, zoom and alignment are easy to check.
