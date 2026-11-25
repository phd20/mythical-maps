/**
 * Where the pin popup goes so Obsidian's page preview does not cover it (spec
 * note-links "Drill-down into a note's maps").
 *
 * The preview lines up with the pin's left edge and sits just below it, or just
 * above it when there is no room below. It lives outside the map view, which is
 * its own stacking context, so the popup cannot be drawn on top of it and has to
 * stay out of its way: beside the pin (left if it fits, else right), growing
 * away from the preview. Pure: no DOM.
 */

/** Room below a pin that the preview needs to open downwards (its height plus the gap). */
export const PREVIEW_ROOM_PX = 420;

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Top-left of a popup of `size` for the pin at `anchor`, relative to `host`.
 * `anchor` and `host` are viewport rectangles; `windowHeight` is that window's.
 */
export function placePopup(
  anchor: Box,
  host: Box,
  size: { width: number; height: number },
  windowHeight: number,
): { left: number; top: number } {
  const fitsLeft = anchor.left - size.width >= host.left;
  const x = fitsLeft ? anchor.left - size.width : anchor.right;
  const previewBelow = windowHeight - anchor.bottom >= PREVIEW_ROOM_PX;
  const y = previewBelow ? anchor.bottom - size.height : anchor.top;
  const within = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
  return {
    left: within(x, host.left, host.right - size.width) - host.left,
    top: within(y, host.top, host.bottom - size.height) - host.top,
  };
}
