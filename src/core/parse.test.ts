import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate, parseMap, type ParseFailureKind } from "./parse";
import { CURRENT_VERSION } from "./schema";

function validDoc(): Record<string, unknown> {
  return {
    type: "mythical-map",
    version: 1,
    image: { path: "Maps/westmarch.webp", width: 8192, height: 6144 },
    viewport: { center: [-12, 16], zoom: 2 },
    features: [
      { id: "k3x9q2mz", type: "folder", name: "Towns", rank: "a0" },
      { id: "p7d1w0ab", type: "pin", parentId: "k3x9q2mz", rank: "a0", pos: [-10.5, 14.25], link: "Rusty Flagon" },
    ],
  };
}

const text = (v: unknown) => JSON.stringify(v, null, 2);

function expectFailure(input: string, kind: ParseFailureKind) {
  const result = parseMap(input);
  if (result.ok) throw new Error("expected parse failure");
  expect(result.kind).toBe(kind);
  expect(result.issues.length).toBeGreaterThan(0);
  return result.issues;
}

describe("parseMap", () => {
  it("parses a valid document", () => {
    const result = parseMap(text(validDoc()));
    expect(result).toEqual({ ok: true, map: validDoc() });
  });

  it("reports malformed JSON with a line and column", () => {
    const issues = expectFailure('{\n  "type": "mythical-map",\n  "features": [1,],\n}', "json");
    expect(issues[0]?.path).toBe("");
    expect(issues[0]?.message).toMatch(/^Invalid JSON at line 3, column 18: /);
  });

  it("reports the position from V8's 'position N' form", () => {
    const issues = expectFailure('{\n  "a": 1\n}\nx', "json");
    expect(issues[0]?.message).toMatch(/^Invalid JSON at line 4, column 1: /);
    expect(issues[0]?.message).not.toMatch(/\(line \d+ column \d+\)/);
  });

  it("reports truncated JSON at the end of the text", () => {
    const issues = expectFailure('{\n  "type": "mythical-map"', "json");
    expect(issues[0]?.message).toMatch(/line 2, column \d+/);
  });

  it("rejects valid JSON that is not an object", () => {
    expect(expectFailure("[1, 2, 3]", "not-mythical")[0]?.message).toMatch(/Not a Mythical map/);
    expectFailure("null", "not-mythical");
    expectFailure('"mythical-map"', "not-mythical");
  });

  it("rejects an object without the type marker", () => {
    const { type: _type, ...rest } = validDoc();
    expectFailure(text(rest), "not-mythical");
    expectFailure(text({ ...validDoc(), type: "something-else" }), "not-mythical");
  });

  it("rejects a future version with an upgrade message", () => {
    const issues = expectFailure(text({ ...validDoc(), version: 99 }), "future-version");
    expect(issues[0]?.path).toBe("version");
    expect(issues[0]?.message).toMatch(/version 99/);
    expect(issues[0]?.message).toMatch(/Upgrade the Mythical Maps plugin/);
  });

  it.each([0, -1, 1.5, "1", null])("rejects version %j as invalid", (version) => {
    const issues = expectFailure(text({ ...validDoc(), version }), "invalid");
    expect(issues).toEqual([{ path: "version", message: "version must be an integer ≥ 1" }]);
  });

  it("rejects a missing version as invalid", () => {
    const { version: _version, ...rest } = validDoc();
    expectFailure(text(rest), "invalid");
  });

  it("reports schema failures as invalid with their paths", () => {
    const doc = validDoc();
    doc.image = { path: "", width: 10, height: 10 };
    (doc.features as Record<string, unknown>[])[1]!.pos = "nowhere";
    const issues = expectFailure(text(doc), "invalid");
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("image.path");
    expect(paths).toContain("features.1.pos");
  });
});

describe("migrate", () => {
  it("has no migrations at v1", () => {
    expect(CURRENT_VERSION).toBe(1);
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it("passes a current-version document through unchanged", () => {
    const doc = validDoc();
    expect(migrate(doc)).toBe(doc);
    expect(doc).toEqual(validDoc());
  });
});

describe("test-vault fixtures", () => {
  const fixture = (name: string) =>
    readFileSync(fileURLToPath(new URL(`../../test-vault/Maps/${name}.map`, import.meta.url)), "utf8");

  it.each(["all-types", "big-8k", "broken-links", "missing-image"])("%s.map parses", (name) => {
    const result = parseMap(fixture(name));
    expect(result.ok ? true : result.issues).toBe(true);
  });

  it.each<[string, ParseFailureKind]>([
    ["invalid-json", "json"],
    ["not-mythical", "not-mythical"],
    ["future-version", "future-version"],
  ])("%s.map fails as %s", (name, kind) => {
    expectFailure(fixture(name), kind);
  });
});
