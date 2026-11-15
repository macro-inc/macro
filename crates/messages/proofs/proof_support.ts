// Shared command-line handling, log parsing and number formatting for the proof
// scripts in this directory.
//
// The recorded reports and CSV files were produced with fixed parsing and
// rounding rules. This module keeps those rules, so rerunning a script over the
// same logs reproduces its recorded output byte for byte.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { type ParseArgsOptionsConfig, parseArgs } from 'node:util';

/** A failed validation or unusable input. The script reports it and exits 1. */
export class ProofError extends Error {}

/** Fails the run when a recorded invariant does not hold. */
export function check(
  condition: boolean,
  ...context: unknown[]
): asserts condition {
  if (condition) {
    return;
  }

  const details = context.map((item) =>
    typeof item === 'string' ? item : JSON.stringify(item)
  );
  throw new ProofError(['check failed', ...details].join(': '));
}

/** Runs a script body, reporting a `ProofError` without a stack trace. */
export function runProof(main: () => void): void {
  try {
    main();
  } catch (error) {
    if (!(error instanceof ProofError)) {
      throw error;
    }

    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

/** Prints the usage paragraph of `help` and the error, then exits 2. */
export function usageError(help: string, message: string): never {
  const usage = help.slice(0, help.indexOf('\n\n'));
  const program = basename(process.argv[1] ?? '');
  process.stderr.write(`${usage}\n${program}: error: ${message}\n`);
  process.exit(2);
}

/**
 * Parses the command line. `-h` or `--help` prints `help` and exits 0; an
 * unknown option or a missing option value exits 2 with the usage.
 */
export function parseCommandLine<const Options extends ParseArgsOptionsConfig>(
  help: string,
  options: Options
) {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    process.stdout.write(help);
    process.exit(0);
  }

  try {
    return parseArgs({ args, options, allowPositionals: true });
  } catch (error) {
    usageError(help, error instanceof Error ? error.message : String(error));
  }
}

/** The usage error text naming every required argument that is absent. */
export function missingArguments(required: Record<string, boolean>): string {
  const missing = Object.keys(required).filter((name) => !required[name]);
  return `the following arguments are required: ${missing.join(', ')}`;
}

// The whitespace set the logs were originally split and trimmed with. It is
// wider than `String.prototype.trim` for control characters and excludes U+FEFF.
const SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const ONE_SPACE = new RegExp(`[${SPACE}]`);
const SURROUNDING_SPACE = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g');
const LINE_BREAK = new RegExp(
  '\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85\\u2028\\u2029]'
);

/** Whether the character is whitespace. */
export function isSpace(character: string): boolean {
  return ONE_SPACE.test(character);
}

/** Removes surrounding whitespace. */
export function strip(text: string): string {
  return text.replace(SURROUNDING_SPACE, '');
}

/** Reads a log and returns its lines without their terminators. */
export function readLines(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split(LINE_BREAK);

  if (lines.at(-1) === '') {
    lines.pop();
  }

  return lines;
}

/** Splits a `| a | b |` table line into its trimmed cells. */
export function tableCells(line: string): string[] {
  return line
    .replace(/^\|+|\|+$/g, '')
    .split('|')
    .map(strip);
}

/**
 * Splits one CSV line into fields. A quote opens a quoted field only at the
 * start of a field, `""` inside one is a literal quote, and text after a
 * closing quote is kept as part of the field.
 */
export function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let state: 'start' | 'plain' | 'quoted' | 'quote_in_quoted' = 'start';

  for (const character of line) {
    if (state === 'quoted') {
      if (character === '"') {
        state = 'quote_in_quoted';
      } else {
        field += character;
      }
      continue;
    }

    if (character === ',') {
      fields.push(field);
      field = '';
      state = 'start';
      continue;
    }

    if (character === '"' && state !== 'plain') {
      // At the start of a field this opens it; after a closing quote it is the
      // second half of an escaped quote.
      if (state === 'quote_in_quoted') {
        field += character;
      }
      state = 'quoted';
      continue;
    }

    field += character;
    state = 'plain';
  }

  fields.push(field);
  return fields;
}

/** Pairs the field names with one line's values. */
export function toRow<Field extends string>(
  fields: readonly Field[],
  values: readonly string[]
): Record<Field, string> {
  const entries = fields.map((field, index) => [field, values[index]]);
  return Object.fromEntries(entries) as Record<Field, string>;
}

function csvLine(values: readonly string[]): string {
  const quoted = values.map((value) =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
  );
  return `${quoted.join(',')}\n`;
}

/** Writes the header and every row as CSV, creating `directory` if needed. */
export function writeRunsCsv<Field extends string>(
  directory: string,
  name: string,
  fields: readonly Field[],
  rows: readonly Record<Field, string>[]
): void {
  mkdirSync(directory, { recursive: true });
  const lines = rows.map((row) => csvLine(fields.map((field) => row[field])));
  writeFileSync(`${directory}/${name}`, csvLine(fields) + lines.join(''));
}

const DIGITS = '\\d+(?:_\\d+)*';
const INTEGER = new RegExp(`^[+-]?${DIGITS}$`);
const DECIMAL = new RegExp(
  `^[+-]?(?:${DIGITS}\\.?(?:${DIGITS})?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?$`
);
const NON_FINITE = /^([+-]?)(inf|infinity|nan)$/i;

/** Parses a whole decimal integer; anything else is an error. */
export function toInt(text: string): number {
  const digits = strip(text);

  if (!INTEGER.test(digits)) {
    throw new ProofError(`invalid integer: ${JSON.stringify(text)}`);
  }

  const value = Number(digits.replaceAll('_', ''));

  if (!Number.isSafeInteger(value)) {
    throw new ProofError(`integer out of range: ${JSON.stringify(text)}`);
  }

  return value;
}

/** Parses a decimal number, `inf` or `nan`; anything else is an error. */
export function toFloat(text: string): number {
  const digits = strip(text);
  const nonFinite = NON_FINITE.exec(digits);

  if (nonFinite) {
    if (nonFinite[2]?.toLowerCase() === 'nan') {
      return Number.NaN;
    }
    return nonFinite[1] === '-' ? -Infinity : Infinity;
  }

  if (!DECIMAL.test(digits)) {
    throw new ProofError(`invalid number: ${JSON.stringify(text)}`);
  }

  return Number(digits.replaceAll('_', ''));
}

/** Integer division result as a float; dividing by zero is an error. */
export function divide(numerator: number, denominator: number): number {
  if (denominator === 0) {
    throw new ProofError('division by zero');
  }

  return numerator / denominator;
}

/** The middle value, or the mean of the two middle values. */
export function median(values: readonly number[]): number {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];

  if (upper === undefined) {
    throw new ProofError('no median for empty data');
  }

  if (sorted.length % 2 === 1) {
    return upper;
  }

  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** Whether every value is finite and at least (or strictly above) zero. */
export function allFinite(
  values: readonly number[],
  bound: 'non_negative' | 'positive'
): boolean {
  return values.every(
    (value) =>
      Number.isFinite(value) && (bound === 'positive' ? value > 0 : value >= 0)
  );
}

/** Whether the values never decrease. */
export function isAscending(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || (values[index - 1] ?? value) <= value
  );
}

/** Whether a recorded rate agrees with one recomputed from its row. */
export function ratesAgree(recorded: number, computed: number): boolean {
  if (recorded === computed) {
    return true;
  }

  if (!Number.isFinite(recorded) || !Number.isFinite(computed)) {
    return false;
  }

  const difference = Math.abs(computed - recorded);
  const relative = 0.001 * Math.max(Math.abs(recorded), Math.abs(computed));
  return difference <= Math.max(relative, 0.11);
}

/**
 * Formats with a fixed number of decimals, rounding the exact binary value and
 * breaking exact ties to the even digit. `toFixed` breaks ties upward and
 * drops the sign of a negative zero, so it cannot reproduce the reports.
 */
export function formatFixed(
  value: number,
  decimals: number,
  sign: 'negative_only' | 'always' = 'negative_only'
): string {
  const negative = value < 0 || Object.is(value, -0);
  const positivePrefix = sign === 'always' ? '+' : '';
  const prefix = negative ? '-' : positivePrefix;

  if (Number.isNaN(value)) {
    return `${positivePrefix}nan`;
  }

  if (!Number.isFinite(value)) {
    return `${prefix}inf`;
  }

  // An IEEE 754 double is mantissa * 2^exponent, with both parts integers.
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(value));
  const bits = view.getBigUint64(0);
  const exponentBits = Number(bits >> 52n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = exponentBits === 0 ? fraction : fraction | (1n << 52n);
  const exponent = Math.max(exponentBits, 1) - 1075;

  // value * 10^decimals as an exact fraction, then rounded half to even.
  let numerator = mantissa * 10n ** BigInt(decimals);
  let denominator = 1n;
  if (exponent >= 0) {
    numerator <<= BigInt(exponent);
  } else {
    denominator <<= BigInt(-exponent);
  }

  let scaled = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  const roundsUp =
    twiceRemainder > denominator ||
    (twiceRemainder === denominator && scaled % 2n === 1n);
  if (roundsUp) {
    scaled += 1n;
  }

  const digits = scaled.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  return `${prefix}${whole}.${digits.slice(digits.length - decimals)}`;
}

/** Orders strings by code point, numbers by value and `false` before `true`. */
export function compareKeys(
  left: readonly (string | number | boolean)[],
  right: readonly (string | number | boolean)[]
): number {
  for (const [index, leftPart] of left.entries()) {
    const rightPart = right[index];
    let order = 0;

    if (typeof leftPart === 'string' && typeof rightPart === 'string') {
      order = compareCodePoints(leftPart, rightPart);
    } else {
      order = Number(leftPart) - Number(rightPart);
    }

    if (order !== 0) {
      return order;
    }
  }

  return 0;
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) =>
    character.codePointAt(0)
  );

  for (const [index, leftPoint] of leftPoints.entries()) {
    const rightPoint = rightPoints[index];

    if (rightPoint === undefined) {
      return 1;
    }

    if (leftPoint !== rightPoint) {
      return (leftPoint ?? 0) - rightPoint;
    }
  }

  return leftPoints.length - rightPoints.length;
}

/** The distinct values in code point order. */
export function sortedDistinct(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

/** Groups rows under a text key, keeping first-seen group order. */
export function groupRows<Row>(
  rows: readonly Row[],
  key: (row: Row) => string
): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const group = groups.get(key(row));

    if (group) {
      group.push(row);
    } else {
      groups.set(key(row), [row]);
    }
  }

  return groups;
}

/** The rows recorded under `key`; a missing group is an error. */
export function groupOf<Row>(groups: Map<string, Row[]>, key: string): Row[] {
  const group = groups.get(key);

  if (!group) {
    throw new ProofError(`no rows for ${key}`);
  }

  return group;
}

/** Whether both sets hold exactly the same keys. */
export function sameKeys(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** Checks that a source revision can be quoted inline in a report. */
export function checkSourceRevision(revision: string): void {
  check(strip(revision) !== '', 'empty source revision');
  check(
    !revision.includes('\n') && !revision.includes('`'),
    'source revision must be one line without backticks'
  );
}

/** Writes report lines joined by newlines, with no trailing newline added. */
export function writeReport(
  directory: string,
  name: string,
  lines: readonly string[]
): void {
  writeFileSync(`${directory}/${name}`, lines.join('\n'));
}
