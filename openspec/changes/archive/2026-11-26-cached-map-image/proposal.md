## Why

Zooming a large map stalls after a pause. On a 6144 by 8192 WebP, the first zoom after opening, after 45 seconds idle or after minimizing froze for about 430 to 490 ms at a time, up to three times in a row. The renderer discards the decoded copy of the `<img>` layer and decodes the whole image again before the next frame can be drawn.

## What Changes

- Large still raster map images are decoded once by the plugin and drawn into canvases that are held while the map is open, replacing the `<img>` layer for those images.
- The image is decoded in the background; features are drawn and usable before the image appears.
- SVG, animated, small and oversized images, and any image that fails to prepare, keep today's `<img>` rendering.
- A fully zoomed-out cached image looks as good as it does today.
- The docs describe the memory held per open map.

Not included: tiling or an image pyramid, caching files on disk, a setting to turn caching off, and any change to the `.map` format.

## Capabilities

### New Capabilities

### Modified Capabilities
- `map-view`: new requirements for keeping large images ready to zoom, loading them, falling back, releasing them and rendering quality.

## Impact

`src/ui/baseMap.ts`, a new image layer in `src/ui/`, a new pure helper in `src/core/`, `src/obsidian/mapView.ts` (supplies the image bytes), `styles.css` if the canvas needs a rule, the Leaflet and DOM test mocks, `README.md` and `docs/reference.md`. No new dependency. No change to the minimum Obsidian version (1.5.0).
