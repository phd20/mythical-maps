// Generates the performance fixture map (bead 8.1, design Risks "Performance check").
//   node scripts/make-perf-fixture.mjs        (or: npm run fixtures:perf)
// Writes test-vault/Maps/perf-8k-200pins.map: 8192x6144 image, 200 pins spread over
// the whole image, 8 folders of 20 pins plus 40 top-level pins. Fully deterministic:
// a seeded PRNG, so reruns produce byte-identical output.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PERF_FIXTURE = {
  name: "perf-8k-200pins.map",
  width: 8192,
  height: 6144,
  image: "Maps/fixture-8k.png",
  pins: 200,
  folders: 8,
};

const SHAPES = ["pin", "diamond", "flag", "marker", "shield", "circle", "banner", "arch"];
const GLYPHS = ["castle", "beer", "swords", "tent", "tree-pine", "skull", "home", "landmark", "anchor", "mountain"];
const COLORS = ["#3366CC", "#CC3333", "#2E7D32", "#A7A7A7", "#8D6E63", "#AA2233", "#F9A825", "#6A1B9A"];
const LINKS = ["Westmarch", "Rusty Flagon", "The Keep"];

/** mulberry32: small seeded PRNG. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n, w) => n.toString(36).padStart(w, "0");

/** Builds the map object (pure; the test calls this too). */
export function buildPerfMap({ width, height, image, pins, folders } = PERF_FIXTURE) {
  const rand = prng(8192);
  const z = Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / 256)));
  const scale = 2 ** z;
  const cols = 20;
  const rows = Math.ceil(pins / cols);
  const cellW = width / cols;
  const cellH = height / rows;
  const features = [];
  const folderIds = [];
  for (let i = 0; i < folders; i++) {
    const id = `f${pad(i, 7)}`;
    folderIds.push(id);
    features.push({ id, type: "folder", name: `Region ${i + 1}`, rank: `a${pad(i, 3)}` });
  }
  const perFolder = Math.floor((pins - 40) / folders);
  const counts = new Array(folderIds.length).fill(0);
  let topRank = folders;
  for (let i = 0; i < pins; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = Math.round((col + 0.1 + rand() * 0.8) * cellW);
    const y = Math.round((row + 0.1 + rand() * 0.8) * cellH);
    const pin = {
      id: `p${pad(i, 7)}`,
      type: "pin",
      name: `Pin ${i + 1} (${x}, ${y})`,
      rank: "",
      pos: [-y / scale, x / scale],
    };
    // A stride walk scatters folder members across the image instead of clustering them.
    const slot = (i * 7) % pins;
    const fi = slot < folders * perFolder ? Math.floor(slot / perFolder) : -1;
    if (fi >= 0) {
      pin.parentId = folderIds[fi];
      pin.rank = `a${pad(counts[fi]++, 3)}`;
    } else {
      pin.rank = `a${pad(topRank++, 3)}`;
    }
    if (i % 10 !== 0) {
      pin.style = {
        iconGlyph: GLYPHS[i % GLYPHS.length],
        iconColor: COLORS[Math.floor(rand() * COLORS.length)],
        iconShape: SHAPES[Math.floor(rand() * SHAPES.length)],
        iconSize: i % 3 === 0 ? "small" : "medium",
      };
    }
    if (i % 25 === 0) pin.link = LINKS[(i / 25) % LINKS.length];
    if (i % 17 === 0) pin.visibilityRange = [0.4, 1];
    features.push(pin);
  }
  return {
    type: "mythical-map",
    version: 1,
    image: { path: image, width, height },
    viewport: { center: [-height / scale / 2, width / scale / 2], zoom: 1 },
    features,
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "test-vault", "Maps");
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, PERF_FIXTURE.name);
  writeFileSync(file, JSON.stringify(buildPerfMap(), null, 2) + "\n");
  console.log(`wrote ${file}`);
}
