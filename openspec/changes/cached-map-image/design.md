## Context

`mountBaseMap` draws the image with `L.imageOverlay`, an `<img>` stretched to the frame bounds. The smooth wheel handler calls `setView(…, { animate: false })` every frame, which resizes that element, so a frame cannot be committed until the pixels are decoded. Chromium drops decoded images that have not been used for a while. A trace in Obsidian showed two full decodes (491 ms and 434 ms) blocking the first zoom after 45 s idle.

Prototypes were compared on the same image (6144 × 8192 WebP, Retina display, synthetic wheel events, one machine). Memory is the process footprint added over no open map, from one or two samples, partly in a GPU process shared with other windows.

| | `<img>` today | One canvas | Held bitmap, redrawn per frame | Tile pyramid |
| --- | --- | --- | --- | --- |
| Worst frame, first zoom | 458 ms | 13 ms | 243 ms | 42 ms |
| Worst frame after 45 s idle | 458 ms | 13 ms | 25 ms | 50 ms |
| Worst frame after minimize | 467 ms | 16 ms | 84 ms | 41 ms |
| Memory while viewing | ~1.7 GB | ~0.5 GB | ~1.1 GB | ~1.1 GB |
| Memory after waiting | ~0.1 GB | ~0.2 GB | ~0.8 GB | ~0.1–0.5 GB |
| Preparation | none | ~0.5 s | ~0.5 s | ~1.9 s |

Observed in the canvas prototype: a freeze of about 480 ms while preparing (it decoded from the `<img>` element), and a slightly grainier, darker look when fully zoomed out.

## Goals / Non-Goals

**Goals:**
- No decode stall while zooming or panning a large map that is already shown.
- No new long freeze at open.
- Everything else (pins, zoom behaviour, pop-outs, live reload) behaves as before.

**Non-Goals:**
- Tiles, disk caches, images beyond the size limits below, mobile verification.
- Releasing the canvas of a map whose tab is hidden.
- Changing the smooth zoom handler.

## Decisions

**D1. Canvases as the overlay element.** The layer is a small subclass of `L.ImageOverlay` whose element is supplied by the plugin (overriding `_initImage` to adopt it): a `<div>` holding the canvases of D6. Leaflet then positions, resizes and zoom-animates it exactly as it does the `<img>`. This relies on a private method of Leaflet, which is pinned at 1.9.4; the override stays in one file with a test. *Alternatives:* a custom `L.Layer` (re-implements overlay positioning and zoom animation); a held `ImageBitmap` redrawn each frame (costlier per frame, more memory); tiles (more work, needs private `_move` calls because each full view reset discards all tiles, and showed seams).

**D2. The view supplies the bytes.** `BaseMapOptions` gains an optional loader that returns the image file's bytes; `MapView` implements it with `vault.readBinary`. The layer builds a `Blob`, calls `createImageBitmap`, draws once and closes the bitmap. Reading the file avoids cross-origin limits on the resource URL, and decoding a `Blob` is expected to run off the main thread. That expectation is not yet measured for this path; task 1.3 checks it.

**D3. No `<img>` while preparing.** For a cacheable image the canvas is added when it has been drawn. Showing an `<img>` first would decode the image twice and bring back the freeze at open. Until then the map shows its background, with features drawn and usable. If preparation fails for any reason, the layer adds the `<img>` overlay instead.

**D4. Which images are cached** is a pure function in `src/core/`, so it is unit tested without a DOM. Cache when all hold:
- the extension is png, jpg, jpeg, webp, bmp or avif;
- the file is not animated (PNG `acTL` chunk, WebP `VP8X` animation flag);
- width × height from the map file is over 8 megapixels. Smaller images decode quickly (about 70 ms at this size, scaled from the measurement) and keep today's rendering;
- neither side is over 16384 px and the area is at most 100 megapixels (about 400 MB). Larger ones keep the `<img>`.

SVG and GIF always keep the `<img>`. AVIF animation is not detected. The thresholds are named constants. The drawn size is checked again from the decoded bitmap, since the map file's size can disagree with the image.

**D5. Lifecycle.** The layer is owned by the base map. `destroy()` marks it cancelled, closes any bitmap that arrives late, and sets the canvas to 0 × 0 to free its memory at once. A changed image file already changes the resource URL and remounts the map, so no extra invalidation is needed. On the canvas's `contextrestored` event the layer prepares the image again. The canvas is created in the container's `ownerDocument`.

**D6. Zoomed-out quality.** The compositor downscales a canvas without the smaller copies it makes for an `<img>`, so a full-size canvas looks grainy when zoomed out. The layer therefore keeps a chain of canvases, each half the width and height of the one before, each made from the previous one with `resizeQuality: "low"` (a box average at exactly half size, like the smaller copies of an `<img>`), down to a longest side of at most 1024 px. They are children of the one overlay element and exactly one is displayed: the smallest that still has at least one image pixel per device pixel, re-chosen as the map zooms, moves or resizes. The layer yields to the event loop before making each copy. The chain adds at most a third to the memory (about 70 MB at 50 megapixels).

A single half-size copy, the first design, was tested and rejected. Mean luminance difference per pixel (0–255) from the `<img>` rendering, 600 × 600 px around the centre, Retina display:

| Device px per image px | Full | Half | Quarter |
| --- | --- | --- | --- |
| 0.25 (fit) | 7.37 | 5.16 | 0.18 |
| 0.35 | 2.58 | 0.26 | 4.56 |
| 0.49 | 2.14 | 0.13 | 4.00 |
| 0.69 | 0.14 | 1.74 | 4.84 |
| 0.98 and above | ≤ 0.07 | ≤ 1.36 | ≤ 3.69 |

## Measured in the plugin (task 1.3)

Same image and machine, with a region added over the map, synthetic wheel events and a development build.

| Measure | Result |
| --- | --- |
| Features shown | before the image |
| Image shown after opening | 523 ms |
| Longest frame while opening | 40 ms |
| Worst frame zooming at once | 9 ms |
| Worst frame after 2 minutes idle | 14 ms |
| Worst frame after 60 s minimized | 13 ms |
| Worst frame, zoom buttons | 12 ms |
| Canvas after closing the tab | 0 × 0, detached |

D2's expectation holds: decoding from a `Blob` removed the freeze at open (about 480 ms in the prototype). No CSS rule was needed, and regions stay above the canvas. Also checked in the app: small, SVG, GIF, flagged-animated and undecodable images use `<img>`; a replaced image file shows after the next reload; `contextrestored` (dispatched by hand) redraws; closing before ready leaves no canvas and no error; pop-out open and move show the image. Not covered: a real trackpad, and an animated image visibly animating (the test files were minimal).

## Measured with the copies (task 1.4)

Same image and machine, synthetic wheel events, development build.

| Measure | Result |
| --- | --- |
| Copies | 6144 × 8192, 3072 × 4096, 1536 × 2048, 768 × 1024 (about 66 MB beyond the full size) |
| Difference from `<img>` fully zoomed out (single canvas: 7.37) | 0.74; by eye the same |
| Difference at other zooms | 1.54 at 0.29 device px per image px, otherwise 0.59 or less |
| Image shown after opening | about 550–580 ms |
| Longest frame while opening, six runs | 54–66 ms |
| Worst frame zooming, at once and after 2 minutes idle | 15 ms |
| Worst frame after 60 s minimized (one direction) | 11 ms |
| Frames without exactly one copy displayed | none |
| Canvases after closing the tab | all 0 × 0 |

Making the copies: resampling with `resizeQuality: "high"` held the main thread for about 190 ms for the first halving, and 250 ms at open. Halving with `"low"` without yielding gave 113 ms; yielding between copies gave the figures above. A worker was timed at 15 ms plus drawing and judged not worth its complexity.

Process memory samples were too noisy to compare the chain with a single canvas: part is in a GPU process shared with other windows. Not verified: a screen without Retina resolution (emulating one did not change the real raster scale), a smallest copy actually displayed (it needs a pane smaller than the ones tested), and flashing as seen by eye.

**Manual checks.** The user reports that the 1.3 check (a real trackpad) and the 1.4 check (zoomed-out quality) pass in their own vault.

## Risks / Trade-offs

- [About 5.3 bytes per pixel held per open map with D6, roughly 270 MB at 50 megapixels] → size limits, release on close, documented. Several large maps add up.
- [Drawing and uploading the canvas still blocks once] → measured in task 1.3; the acceptance limit is no frame over 100 ms after the image appears.
- [A very large canvas can fail silently on weak hardware] → limits in D4; fall back on a missing context or a thrown draw. A silent blank canvas cannot be detected reliably; report it if seen.
- [Moving a tab to a pop-out may clear the canvas] → `contextrestored` handling and a manual check.
- [Synthetic events and one machine in the prototypes] → the manual check uses a real trackpad and a longer pause.
- [Mobile memory limits] → mobile stays untested; noted in the reference.

## Migration Plan

No data or settings change. Rolling back is reverting the plugin version.
