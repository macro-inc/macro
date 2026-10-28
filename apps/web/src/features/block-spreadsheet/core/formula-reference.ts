import {
  type CellSelection,
  cellAddress,
  positionFromAddress,
  selectionBounds,
} from './grid-selection';
import {
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';

export type FormulaTextSelection = { start: number; end: number };

export const FORMULA_REFERENCE_COLORS = [
  'var(--color-blue)',
  'var(--color-red)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-orange)',
  'var(--color-pink)',
  'var(--color-teal)',
];

type RangeBounds = { top: number; bottom: number; left: number; right: number };

export type FormulaReferenceSpan = {
  start: number;
  end: number;
  color: string;
};

export type ReferenceHighlight = { bounds: RangeBounds; color: string };

export type FormulaReference = FormulaReferenceSpan & {
  /** The sheet named by the reference; absent means the formula's own sheet. */
  sheetName?: string;
  bounds: RangeBounds;
};

const CELL = String.raw`\$?[A-Z]{1,3}\$?[1-9]\d*`;
const COLUMN = String.raw`\$?[A-Z]{1,3}`;
const ROW = String.raw`\$?[1-9]\d*`;
const REFERENCE = new RegExp(
  String.raw`(?:('(?:[^']|'')+'|[A-Z_][\w.]*)!)?(${CELL}(?::${CELL})?|${COLUMN}:${COLUMN}|${ROW}:${ROW})`,
  'gi'
);

function referenceBounds(range: string) {
  const [first, last = first] = range.replaceAll('$', '').split(':');
  if (/^\d+$/.test(first)) {
    const top = positionFromAddress(`A${first}`)?.row;
    const bottom = positionFromAddress(`A${last}`)?.row;
    if (top === undefined || bottom === undefined) return;
    return {
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      left: 0,
      right: SPREADSHEET_MAX_COLUMNS - 1,
    };
  }
  if (/^[A-Z]+$/i.test(first)) {
    const left = positionFromAddress(`${first}1`)?.column;
    const right = positionFromAddress(`${last}1`)?.column;
    if (left === undefined || right === undefined) return;
    return {
      top: 0,
      bottom: SPREADSHEET_MAX_ROWS - 1,
      left: Math.min(left, right),
      right: Math.max(left, right),
    };
  }
  const anchor = positionFromAddress(first);
  const focus = positionFromAddress(last);
  return anchor && focus ? selectionBounds({ anchor, focus }) : undefined;
}

/** String literals and quoted sheet names, from opening to closing quote. */
function quotedRanges(text: string) {
  const quoted: { from: number; to: number }[] = [];
  let quote: { char: string; from: number } | undefined;
  for (let index = 1; index < text.length; index++) {
    const char = text[index];
    if (quote?.char === char) {
      if (text[index + 1] === char) index++;
      else {
        quoted.push({ from: quote.from, to: index });
        quote = undefined;
      }
    } else if (!quote && (char === '"' || char === "'"))
      quote = { char, from: index };
  }
  if (quote) quoted.push({ from: quote.from, to: text.length });
  return quoted;
}

/**
 * The cell and range references in a formula, each colored like Excel: the
 * same reference written twice shares a color.
 */
export function formulaReferences(text: string): FormulaReference[] {
  if (!text.startsWith('=')) return [];
  const quoted = quotedRanges(text);
  const colors = new Map<string, string>();
  const references: FormulaReference[] = [];
  for (const match of text.matchAll(REFERENCE)) {
    const from = match.index;
    const to = from + match[0].length;
    if (quoted.some((range) => from > range.from && from <= range.to)) continue;
    if (
      /[\w.$!:]/.test(text[from - 1] ?? '') ||
      /[\w.!(:$]/.test(text[to] ?? '')
    )
      continue;
    const bounds = referenceBounds(match[2]);
    if (!bounds) continue;
    const sheetName = match[1]?.startsWith("'")
      ? match[1].slice(1, -1).replaceAll("''", "'")
      : match[1];
    const key = `${sheetName?.toUpperCase() ?? ''}!${match[2].replaceAll('$', '').toUpperCase()}`;
    let color = colors.get(key);
    if (!color) {
      color =
        FORMULA_REFERENCE_COLORS[colors.size % FORMULA_REFERENCE_COLORS.length];
      colors.set(key, color);
    }
    references.push({ start: from, end: to, sheetName, bounds, color });
  }
  return references;
}

/** Find an operand slot without treating strings or function names as references. */
export function formulaReferenceSlot(
  text: string,
  selection: FormulaTextSelection
) {
  const { start, end } = selection;
  if (!text.startsWith('=') || start < 1 || end < start || end > text.length)
    return;
  let quote: string | undefined;
  for (let index = 1; index < start; index++) {
    const char = text[index];
    if (quote === char) {
      if (text[index + 1] === quote) index++;
      else quote = undefined;
    } else if (!quote && (char === '"' || char === "'")) quote = char;
  }
  if (quote === '"') return;

  // A caret in/on a reference replaces the entire reference, including its range.
  const references =
    /(?:(?:'(?:[^']|'')+'|[A-Z_][\w.]*)!)?\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?/gi;
  for (const match of text.matchAll(references)) {
    const from = match.index;
    const to = from + match[0].length;
    if (from > start || to < end) continue;
    if (/[\w.$!]/.test(text[from - 1] ?? '') || /[\w.!(:]/.test(text[to] ?? ''))
      continue;
    return { start: from, end: to };
  }

  if (quote) return;

  // Point mode begins after an operator or argument separator. A completed
  // expression still commits normally when the user clicks elsewhere.
  if (!/[=+\-*/^&<>,;({:]\s*$/.test(text.slice(0, start))) return;
  if (start === end && /^[\w.$!'"]/.test(text.slice(end))) return;
  return { start, end };
}

export function formulaRangeReference(
  selection: CellSelection,
  sheetName?: string
) {
  const { top, bottom, left, right } = selectionBounds(selection);
  const first = cellAddress({ row: top, column: left });
  const last = cellAddress({ row: bottom, column: right });
  const range = first === last ? first : `${first}:${last}`;
  if (!sheetName) return range;
  // Always quote sheet names: names like A1 and names containing apostrophes
  // are valid tabs but ambiguous or invalid when inserted without escaping.
  return `'${sheetName.replaceAll("'", "''")}'!${range}`;
}
