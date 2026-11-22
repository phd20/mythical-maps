// Builds the plugin bundle.
//   node esbuild.config.mjs production  → ./main.js (minified, no sourcemap)
//   node esbuild.config.mjs dev         → watch build into test-vault/.obsidian/plugins/mythical-maps/
import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2] === "dev" ? "dev" : "production";
const prod = mode === "production";
const DEV_DIR = "test-vault/.obsidian/plugins/mythical-maps";
const outdir = prod ? "." : DEV_DIR;

/** Copies manifest.json and styles.css next to the dev bundle after each build. */
const copyAssets = {
  name: "copy-assets",
  setup(build) {
    build.onEnd(() => {
      if (prod) return;
      mkdirSync(DEV_DIR, { recursive: true });
      for (const f of ["manifest.json", "styles.css"]) {
        if (existsSync(f)) copyFileSync(f, join(DEV_DIR, f));
      }
      // Hot-reload plugin support: touching .hotreload makes it reload on change.
      copyFileSync("manifest.json", join(DEV_DIR, ".hotreload"));
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: join(outdir, "main.js"),
  plugins: [copyAssets],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
