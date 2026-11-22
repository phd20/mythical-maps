// Generates the test-vault fixture images (design D11).
//   node scripts/make-fixture-images.mjs        (or: npm run fixtures)
// Writes test-vault/Maps/fixture-4k.png (4096×3072) and fixture-8k.png (8192×6144).
//
// Dependency-free: the PNG is written by hand (signature, IHDR, IDAT, IEND) with
// node:zlib for deflate and a local CRC32. Rows are built one at a time and fed
// through a streaming deflater, so memory stays flat even for the 8k image.
import { Buffer } from "node:buffer";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeflate } from "node:zlib";

export const FIXTURES = [
  { name: "fixture-4k.png", width: 4096, height: 3072 },
  { name: "fixture-8k.png", width: 8192, height: 6144 },
];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (PNG / zlib polynomial) over one or more buffers. */
export function crc32(...bufs) {
  let c = 0xffffffff;
  for (const buf of bufs) {
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeBuf, data), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Fills one scanline (filter byte 0 + RGB) for row `y`.
 * Background: a soft colour gradient (red grows left→right, green top→bottom).
 * Grid: a thin line every 256 px and a thicker, darker line every 1024 px,
 * plus a magenta border so the image edges are obvious.
 */
function fillRow(row, y, width, height) {
  row[0] = 0;
  const g = Math.round(90 + (y / Math.max(1, height - 1)) * 140);
  const yMajor = y % 1024 < 6;
  const yMinor = y % 256 < 2;
  const yEdge = y < 8 || y >= height - 8;
  for (let x = 0, o = 1; x < width; x++, o += 3) {
    if (yEdge || x < 8 || x >= width - 8) {
      row[o] = 220; row[o + 1] = 0; row[o + 2] = 200;
    } else if (yMajor || x % 1024 < 6) {
      row[o] = 25; row[o + 1] = 25; row[o + 2] = 40;
    } else if (yMinor || x % 256 < 2) {
      row[o] = 90; row[o + 1] = 90; row[o + 2] = 110;
    } else {
      row[o] = Math.round(90 + (x / Math.max(1, width - 1)) * 140);
      row[o + 1] = g;
      row[o + 2] = 170;
    }
  }
}

/** Writes an RGB PNG of the given size to `file`. Resolves when the file is closed. */
export async function writeFixturePng(file, width, height) {
  mkdirSync(dirname(file), { recursive: true });
  const out = createWriteStream(file);
  const closed = new Promise((res, rej) => {
    out.on("close", res);
    out.on("error", rej);
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  out.write(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  out.write(chunk("IHDR", ihdr));

  const deflate = createDeflate({ level: 6 });
  deflate.on("data", (data) => out.write(chunk("IDAT", data)));
  const deflated = new Promise((res, rej) => {
    deflate.on("end", res);
    deflate.on("error", rej);
  });

  for (let y = 0; y < height; y++) {
    const row = Buffer.allocUnsafe(1 + width * 3);
    fillRow(row, y, width, height);
    if (!deflate.write(row)) await new Promise((res) => deflate.once("drain", res));
  }
  deflate.end();
  await deflated;

  out.end(chunk("IEND", Buffer.alloc(0)));
  await closed;
}

/**
 * Generates the fixture images into `outDir`.
 * `sizes` overrides the default list (tests use tiny images).
 */
export async function generateFixtureImages(outDir, sizes = FIXTURES) {
  const written = [];
  for (const { name, width, height } of sizes) {
    const file = join(outDir, name);
    await writeFixturePng(file, width, height);
    written.push(file);
  }
  return written;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "test-vault", "Maps");
  for (const { name, width, height } of FIXTURES) {
    const t0 = Date.now();
    await writeFixturePng(join(outDir, name), width, height);
    console.log(`wrote ${join(outDir, name)} (${width}×${height}) in ${Date.now() - t0} ms`);
  }
}
