/**
 * Loads Geoman (free) for geometry drawing and editing (design D5, bead 5.3).
 *
 * Geoman's browser build is a self-contained script that patches the global
 * `L`, so our own bundled Leaflet must be published there first. ES modules
 * evaluate imports in order, so `./leafletGlobal` (which sets `globalThis.L`)
 * runs before the Geoman import below. Geoman's CSS is bundled into
 * `styles.css`, scoped under `.mythical-map-view` (`scripts/scope-leaflet-css.mjs`).
 *
 * vitest aliases `@geoman-io/leaflet-geoman-free` to an empty module (tests
 * use a recording Leaflet stub with its own `pm`).
 */
import "./leafletGlobal";
import "@geoman-io/leaflet-geoman-free";
