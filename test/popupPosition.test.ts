import { describe, expect, it } from "vitest";
import { placePopup, PREVIEW_ROOM_PX, type Box } from "../src/ui/popupPosition";

const host: Box = { left: 300, top: 80, right: 1600, bottom: 1080 };
const size = { width: 160, height: 72 };
const WINDOW = 1084;
const pinAt = (left: number, top: number): Box => ({ left, top, right: left + 32, bottom: top + 32 });

/** The popup's viewport rectangle. */
function place(pin: Box): Box {
  const { left, top } = placePopup(pin, host, size, WINDOW);
  return { left: left + host.left, top: top + host.top, right: left + host.left + size.width, bottom: top + host.top + size.height };
}

describe("placePopup", () => {
  it("sits left of the pin and ends level with it when the preview opens below", () => {
    const pin = pinAt(828, 447);
    const box = place(pin);
    expect(box.right).toBe(pin.left);
    expect(box.bottom).toBe(pin.bottom);
  });

  it("sits left of the pin and starts level with it when the preview opens above", () => {
    const pin = pinAt(828, WINDOW - PREVIEW_ROOM_PX);
    const box = place(pin);
    expect(box.right).toBe(pin.left);
    expect(box.top).toBe(pin.top);
  });

  it("moves to the right of a pin near the left edge, still clear of the preview's side", () => {
    const pin = pinAt(348, 447);
    const box = place(pin);
    expect(box.left).toBe(pin.right);
    expect(box.bottom).toBe(pin.bottom);
  });

  it("stays inside the map at the top and bottom edges", () => {
    expect(place(pinAt(828, 82)).top).toBe(host.top);
    expect(place(pinAt(828, 1070)).bottom).toBe(host.bottom);
  });
});
