import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  allSelectors,
  BEGIN_MARKER,
  END_MARKER,
  expectedStyles,
  GEOMAN_BEGIN_MARKER,
  GEOMAN_END_MARKER,
  LEAFLET_CSS,
  parseCss,
  scopeLeafletCss,
  scopeSelector,
  SCOPE,
  spliceGenerated,
  STYLES_CSS,
} from "../scripts/scope-leaflet-css.mjs";

const styles = readFileSync(STYLES_CSS, "utf8");
const leaflet = readFileSync(LEAFLET_CSS, "utf8");

describe("styles.css", () => {
  it("scopes every selector under .mythical-map-view", () => {
    const selectors = allSelectors(parseCss(styles));
    expect(selectors.length).toBeGreaterThan(100);
    const unscoped = selectors.filter((s) => !s.split(/\s+/).some((part) => part === SCOPE || part.startsWith(`${SCOPE}.`)));
    expect(unscoped).toEqual([]);
  });

  it("contains the current Leaflet CSS (run `npm run css` if this fails)", () => {
    expect(styles).toContain(BEGIN_MARKER);
    expect(styles).toContain(END_MARKER);
    expect(styles).toBe(expectedStyles(styles, leaflet));
  });

  it("bundles every Leaflet selector and no url() references", () => {
    const begin = styles.indexOf(BEGIN_MARKER);
    const end = styles.indexOf(END_MARKER);
    const section = styles.slice(begin, end);
    expect(section).not.toMatch(/url\(/i);
    for (const sel of [".leaflet-container", ".leaflet-pane", ".leaflet-zoom-animated", ".leaflet-control-zoom"]) {
      expect(section).toContain(`${SCOPE} ${sel}`);
    }
  });
});

describe("styles.css Geoman section (bead 5.3)", () => {
  it("bundles Geoman's CSS scoped, without url() references", () => {
    const begin = styles.indexOf(GEOMAN_BEGIN_MARKER);
    const end = styles.indexOf(GEOMAN_END_MARKER);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const section = styles.slice(begin, end);
    expect(section).not.toMatch(/url\(/i);
    for (const sel of [".marker-icon", ".geoman-draw-cursor", ".leaflet-pm-draggable"]) {
      expect(section).toContain(`${SCOPE} ${sel}`);
    }
  });
});

describe("scope-leaflet-css", () => {
  it("prefixes selectors, keeping body-level .leaflet-dragging outside the scope", () => {
    expect(scopeSelector(".leaflet-pane > svg")).toBe(".mythical-map-view .leaflet-pane > svg");
    expect(scopeSelector(".leaflet-dragging .leaflet-grab")).toBe(".leaflet-dragging .mythical-map-view .leaflet-grab");
  });

  it("drops url() declarations and rules left empty, and scopes inside @media", () => {
    const out = scopeLeafletCss(`
      /* c */ .a, .b { color: red; background-image: url(x.png); }
      .c { behavior: url(#default#VML); }
      @media print { .d { color: blue } }
    `);
    expect(out).toBe(
      [
        ".mythical-map-view .a,",
        ".mythical-map-view .b {",
        "  color: red;",
        "}",
        "@media print {",
        "  .mythical-map-view .d {",
        "    color: blue;",
        "  }",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("spliceGenerated replaces the marked section and is idempotent", () => {
    const base = `/* head */\n${BEGIN_MARKER}\nold\n${END_MARKER}\n.mythical-map-view .x { color: red; }\n`;
    const once = spliceGenerated(base, ".mythical-map-view .y {\n  top: 0;\n}\n");
    expect(once).toContain(".mythical-map-view .y");
    expect(once).not.toContain("old");
    expect(once.endsWith(".mythical-map-view .x { color: red; }\n")).toBe(true);
    expect(spliceGenerated(once, ".mythical-map-view .y {\n  top: 0;\n}\n")).toBe(once);
    const appended = spliceGenerated(".mythical-map-view .x {}\n", "gen\n");
    expect(appended).toBe(`.mythical-map-view .x {}\n\n${BEGIN_MARKER}\ngen\n${END_MARKER}\n`);
  });

  it("rejects unbalanced CSS", () => {
    expect(() => parseCss(".a { color: red;")).toThrow();
    expect(() => parseCss("}")).toThrow();
  });
});

describe("styles.css pin glyph", () => {
  it("raises the icon only on shapes whose body sits high; the pin shape is centred", () => {
    const rule = /([^{}]*)\{\s*bottom: 22%;\s*\}/.exec(styles)?.[1] ?? "";
    expect(rule).toContain(".mythical-map-pin-shield .mythical-map-pin-glyph");
    expect(rule).not.toContain(".mythical-map-pin-pin .mythical-map-pin-glyph");
  });
});
