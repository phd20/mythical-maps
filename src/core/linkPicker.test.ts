import { describe, expect, it } from "vitest";
import { linkChoices } from "./linkPicker";

const files = ["Places/Westmarch.md", "Zed/Westmarch.md", "Notes/Inn.md", "Maps/a.png", "Maps/Westmarch.map"];
const fake = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  const dupes = files.filter((f) => f.endsWith(`/${name}.md`)).length;
  return dupes > 1 ? path.replace(/\.md$/, "") : name;
};

describe("linkChoices", () => {
  it("lists only markdown notes, sorted, with shortest unambiguous linktext", () => {
    expect(linkChoices(files, "Maps/Westmarch.map", fake)).toEqual([
      { path: "Notes/Inn.md", linktext: "Inn" },
      { path: "Places/Westmarch.md", linktext: "Places/Westmarch" },
      { path: "Zed/Westmarch.md", linktext: "Zed/Westmarch" },
    ]);
  });

  it("passes the map path so linktext is relative to it", () => {
    const seen: string[] = [];
    linkChoices(["A.md"], "Maps/x.map", (_p, m) => {
      seen.push(m);
      return "A";
    });
    expect(seen).toEqual(["Maps/x.map"]);
  });

  it("does not mutate its input", () => {
    const input = ["b.md", "a.md"];
    linkChoices(input, "m.map", (p) => p);
    expect(input).toEqual(["b.md", "a.md"]);
  });
});
