import { describe, expect, it } from "vitest";
import { ID_PATTERN, newId, rankAfter, rankBefore, rankBetween } from "./ids";

/** Deterministic PRNG (mulberry32) returning values in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("newId", () => {
  it("matches the id format", () => {
    expect(newId()).toMatch(/^[a-z][0-9a-z]{7}$/);
  });

  it("stays well-formed and unique over many generations", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const id = newId(seen);
      expect(id).toMatch(ID_PATTERN);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(5000);
  });

  it("accepts any iterable of existing ids", () => {
    const existing = ["abc12345", "zzzzzzzz"];
    const id = newId(existing.values());
    expect(existing).not.toContain(id);
    expect(id).toMatch(ID_PATTERN);
  });

  it("is deterministic with an injected random source", () => {
    expect(newId([], seeded(42))).toBe(newId([], seeded(42)));
  });

  it("retries on collision with an existing id", () => {
    const first = newId([], seeded(7));
    const second = newId([first], seeded(7));
    expect(second).not.toBe(first);
    expect(second).toMatch(ID_PATTERN);
  });

  it("handles edge values from the random source", () => {
    expect(newId([], () => 0)).toBe("a0000000");
    expect(newId([], () => 0.9999999999)).toBe("zzzzzzzz");
  });

  it("throws when no unique id can be found", () => {
    expect(() => newId(["a0000000"], () => 0)).toThrow(/unique id/);
  });
});

describe("ranks", () => {
  it("inserts strictly between a0 and a1", () => {
    const r = rankBetween("a0", "a1");
    expect(r > "a0").toBe(true);
    expect(r < "a1").toBe(true);
  });

  it("inserts before the first sibling", () => {
    const r = rankBetween(null, "a0");
    expect(r < "a0").toBe(true);
    expect(rankBefore("a0")).toBe(r);
  });

  it("appends after the last sibling", () => {
    const r = rankAfter("a0");
    expect(r > "a0").toBe(true);
    expect(rankBetween("a0", null)).toBe(r);
  });

  it("starts an empty list with a0", () => {
    expect(rankBetween(null, null)).toBe("a0");
    expect(rankAfter(null)).toBe("a0");
    expect(rankBefore(null)).toBe("a0");
  });

  it("keeps 50 successive inserts toward the same lower bound strictly ordered", () => {
    const lower = "a0";
    const keys = [lower, "a1"];
    let upper = "a1";
    for (let i = 0; i < 50; i++) {
      const k = rankBetween(lower, upper);
      expect(k > lower).toBe(true);
      expect(k < upper).toBe(true);
      keys.push(k);
      upper = k;
    }
    const sorted = [...keys].sort();
    expect(new Set(keys).size).toBe(keys.length);
    // Each new key is smaller than the previous one, so reverse insertion order is sorted order.
    expect(sorted).toEqual([lower, ...keys.slice(2).reverse(), "a1"]);
  });

  it("keeps 50 successive appends and prepends strictly ordered", () => {
    let last = rankAfter(null);
    let first = last;
    for (let i = 0; i < 50; i++) {
      const next = rankAfter(last);
      expect(next > last).toBe(true);
      last = next;
      const prev = rankBefore(first);
      expect(prev < first).toBe(true);
      first = prev;
    }
  });

  it("does not change existing ranks when inserting", () => {
    const siblings = ["a0", "a1", "a2"];
    const before = [...siblings];
    rankBetween(siblings[0] ?? null, siblings[1] ?? null);
    expect(siblings).toEqual(before);
  });

  it("rejects out-of-order bounds", () => {
    expect(() => rankBetween("a1", "a0")).toThrow();
  });
});
