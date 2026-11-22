import { describe, expect, it } from "vitest";
import { SizeGate, type Size } from "../src/ui/sizeGate";

function gate(initial: Size) {
  let size = initial;
  const log: string[] = [];
  const g = new SizeGate({
    getSize: () => size,
    onResize: () => log.push(`resize ${size.width}x${size.height}`),
    onFirstSize: () => log.push("fit"),
  });
  return { g, log, setSize: (s: Size) => (size = s) };
}

describe("SizeGate", () => {
  it("fits immediately when the container already has a size", () => {
    const { g, log } = gate({ width: 800, height: 600 });
    g.check();
    expect(log).toEqual(["resize 800x600", "fit"]);
    expect(g.hasSize).toBe(true);
  });

  it("defers the fit while the container is 0×0 (background tab), then fits once shown", () => {
    const { g, log, setSize } = gate({ width: 0, height: 0 });
    g.check();
    g.check(true);
    expect(log).toEqual([]);
    expect(g.hasSize).toBe(false);
    setSize({ width: 800, height: 0 });
    g.check();
    expect(log).toEqual([]);
    setSize({ width: 800, height: 600 });
    g.check();
    expect(log).toEqual(["resize 800x600", "fit"]);
  });

  it("fits only once; later size changes only invalidate", () => {
    const { g, log, setSize } = gate({ width: 800, height: 600 });
    g.check();
    setSize({ width: 400, height: 600 });
    g.check();
    expect(log).toEqual(["resize 800x600", "fit", "resize 400x600"]);
  });

  it("skips unchanged sizes unless forced, and ignores hiding again", () => {
    const { g, log, setSize } = gate({ width: 800, height: 600 });
    g.check();
    g.check();
    expect(log).toHaveLength(2);
    g.check(true);
    expect(log).toEqual(["resize 800x600", "fit", "resize 800x600"]);
    setSize({ width: 0, height: 0 });
    g.check(true);
    expect(log).toHaveLength(3);
  });
});
