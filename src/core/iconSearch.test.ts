import { describe, expect, it } from "vitest";
import { iconName, searchIcons } from "./iconSearch";

const ids = ["lucide-castle", "lucide-sand-castle", "lucide-cast", "lucide-map-pin", "lucide-map-pin-off", "lucide-broadcast", "dice"];

describe("searchIcons", () => {
  it("drops the lucide- prefix and keeps other ids", () => {
    expect(iconName("lucide-castle")).toBe("castle");
    expect(iconName("dice")).toBe("dice");
  });

  it("ranks exact, then prefix, then word start, then substring", () => {
    expect(searchIcons(ids, "Cast")).toEqual(["cast", "castle", "sand-castle", "broadcast"]);
  });

  it("matches words separated by spaces, in any order", () => {
    expect(searchIcons(ids, "map pin")).toEqual(["map-pin", "map-pin-off"]);
    expect(searchIcons(ids, "pin map")).toEqual(["map-pin", "map-pin-off"]);
  });

  it("lists everything for a blank query and nothing for no match", () => {
    expect(searchIcons(ids, " ")).toHaveLength(ids.length);
    expect(searchIcons(ids, "zzz")).toEqual([]);
  });
});
