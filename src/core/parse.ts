/**
 * Parse `.map` text into a validated `MapDocument` (design D2, spec map-file
 * "Invalid files are never overwritten" and "Versioning and migration").
 *
 * Order: JSON.parse → type marker → version check → `migrate()` → `validateMap`.
 * Any failure returns a typed kind so callers can refuse to write the file.
 */
import { CURRENT_VERSION, MAP_TYPE, validateMap, type MapDocument, type ValidationIssue } from "./schema";

export type ParseFailureKind = "json" | "not-mythical" | "future-version" | "invalid";

export type ParseResult =
  | { ok: true; map: MapDocument }
  | { ok: false; kind: ParseFailureKind; issues: ValidationIssue[] };

/** One step upgrades a document from the keyed version to the next. Empty for v1. */
export const MIGRATIONS: Readonly<Record<number, (raw: Record<string, unknown>) => Record<string, unknown>>> = {};

/**
 * Upgrade a raw document to `CURRENT_VERSION` by running each migration step
 * from its `version`. With no migrations (v1) it returns the input unchanged.
 */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let doc = raw;
  let version = typeof doc.version === "number" ? doc.version : CURRENT_VERSION;
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`No migration from map version ${version}`);
    doc = step(doc);
    version += 1;
    doc = { ...doc, version };
  }
  return doc;
}

/** 1-based line and column of a character offset in `text`. */
function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1] ?? "").length + 1 };
}

/**
 * Offset of the bad token in V8's `Unexpected token 'X', "…context…" is not
 * valid JSON` form, which has no "position N". V8 quotes about 10 characters
 * either side of the token, preceded by `...` when it trimmed the start.
 */
function unexpectedTokenOffset(text: string, message: string): number | undefined {
  const match = /^Unexpected token '(.+?)', (\.\.\.)?"([\s\S]*?)"(\.\.\.)? is not valid JSON$/.exec(message);
  const token = match?.[1];
  const context = match?.[3];
  if (token === undefined || !context) return undefined;
  const start = text.indexOf(context);
  if (start < 0) return undefined;
  const within = context.indexOf(token, match?.[2] ? 9 : 0);
  return within < 0 ? undefined : start + within;
}

/** JSON.parse error message with a line/column position derived from V8's "position N". */
function jsonErrorMessage(text: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Drop V8's own "(line X column Y)" suffix so the position appears once.
  const message = raw.replace(/\s*\(line \d+ column \d+\)\s*$/, "");
  const match = /position (\d+)/.exec(message);
  let offset: number | undefined;
  if (match?.[1] !== undefined) offset = Number(match[1]);
  else if (/end of JSON input/i.test(message)) offset = text.length;
  else offset = unexpectedTokenOffset(text, message);
  if (offset === undefined) return `Invalid JSON: ${message}`;
  const { line, column } = lineColumn(text, offset);
  return `Invalid JSON at line ${line}, column ${column}: ${message}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (kind: ParseFailureKind, path: string, message: string): ParseResult => ({
  ok: false,
  kind,
  issues: [{ path, message }],
});

/** Parse and validate `.map` file text. Never throws. */
export function parseMap(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail("json", "", jsonErrorMessage(text, error));
  }

  if (!isRecord(raw) || raw.type !== MAP_TYPE) {
    return fail("not-mythical", isRecord(raw) ? "type" : "", `Not a Mythical map (type must be "${MAP_TYPE}")`);
  }

  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return fail("invalid", "version", "version must be an integer ≥ 1");
  }
  if (version > CURRENT_VERSION) {
    return fail(
      "future-version",
      "version",
      `This map uses format version ${version}, but this plugin supports up to version ${CURRENT_VERSION}. Upgrade the Mythical Maps plugin to open it.`,
    );
  }

  const result = validateMap(migrate(raw));
  if (!result.ok) return { ok: false, kind: "invalid", issues: result.issues };
  return { ok: true, map: result.map };
}
