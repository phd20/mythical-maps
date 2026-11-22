// Feature ids and sibling ranks (design D1/D2, spec "Stable ids and ordering").
// Pure core module: no obsidian or leaflet imports.
import { generateKeyBetween } from "fractional-indexing";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALPHANUM = "0123456789abcdefghijklmnopqrstuvwxyz";
const ID_LENGTH = 8;
const MAX_ATTEMPTS = 1000;

/** Feature id shape: a lowercase letter followed by 7 lowercase alphanumerics. */
export const ID_PATTERN = /^[a-z][0-9a-z]{7}$/;

/** Uniform random number in [0, 1) from the platform CSPRNG. */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] ?? 0) / 0x1_0000_0000;
}

function pick(alphabet: string, rand: () => number): string {
  const r = rand();
  const i = Math.min(alphabet.length - 1, Math.max(0, Math.floor(r * alphabet.length)));
  return alphabet.charAt(i);
}

/**
 * Generate a new feature id matching `^[a-z][0-9a-z]{7}$` that is not in
 * `existing`. `rand` (returning values in [0, 1)) can be injected for
 * deterministic tests; it defaults to `crypto.getRandomValues`.
 */
export function newId(existing: Iterable<string> = [], rand: () => number = cryptoRandom): string {
  const taken = existing instanceof Set ? (existing as Set<string>) : new Set(existing);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let id = pick(LETTERS, rand);
    for (let i = 1; i < ID_LENGTH; i++) id += pick(ALPHANUM, rand);
    if (!taken.has(id)) return id;
  }
  throw new Error(`newId: could not generate a unique id after ${MAX_ATTEMPTS} attempts`);
}

/** Rank strictly between `a` and `b` (null = open end). Requires a < b. */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`rankBetween: lower bound ${a} must sort before upper bound ${b}`);
  }
  return generateKeyBetween(a, b);
}

/** Rank strictly after `last` (null = first rank in an empty list). */
export function rankAfter(last: string | null): string {
  return generateKeyBetween(last, null);
}

/** Rank strictly before `first` (null = first rank in an empty list). */
export function rankBefore(first: string | null): string {
  return generateKeyBetween(null, first);
}
