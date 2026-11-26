# Development

Requirements: Node.js 22.12 or newer and Obsidian 1.5.0 or newer.

```bash
npm install
npm run fixtures   # fixture images for the test vault (gitignored)
npm run dev        # watch build into test-vault/.obsidian/plugins/mythical-maps/
npm run check      # tsc --noEmit + eslint + vitest + production build
```

Open `test-vault/` in Obsidian with **Open folder as vault** and enable the plugin. [test-vault/README.md](../test-vault/README.md) lists the fixtures, and [test-vault/ACCEPTANCE.md](../test-vault/ACCEPTANCE.md) is the manual acceptance checklist.

## Layout

```
src/main.ts    plugin entry
src/core/      pure TypeScript (no obsidian/leaflet imports): schema, parse/serialize, frame, ids,
               feature tree, document store (lock + undo), links, style resolution
src/obsidian/  settings, the .map view, commands, vault map index, rename listener
src/ui/        Leaflet layers, Geoman editing, toolbar, feature panel
test/          unit tests, with hand-written Obsidian and Leaflet mocks
test-vault/    manual-test vault
```

## Specs

Requirements live in [openspec/specs/](../openspec/specs/). The v1 proposal and design are in [openspec/changes/archive/2026-11-26-add-map-core-v1/](../openspec/changes/archive/2026-11-26-add-map-core-v1/). Conventions for contributors and coding agents are in [CLAUDE.md](../CLAUDE.md).

## Releasing

1. Set the same version in `manifest.json` and `package.json` (and `package-lock.json`), and add it to `versions.json` with the minimum Obsidian version.
2. Run `npm ci` and `npm run check`.
3. Create a GitHub release whose tag is exactly the version (no `v`), with `main.js`, `manifest.json` and `styles.css` attached.
