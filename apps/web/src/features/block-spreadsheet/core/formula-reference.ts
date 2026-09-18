import {
  type CellSelection,
  cellAddress,
  selectionBounds,
} from './grid-selection';

export type FormulaTextSelection = { start: number; end: number };

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
  if (quote) return;

  // A caret in/on a reference replaces the entire reference, including its range.
  const references = /\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?/gi;
  for (const match of text.matchAll(references)) {
    const from = match.index;
    const to = from + match[0].length;
    if (from > start || to < end) continue;
    if (/[\w.$!]/.test(text[from - 1] ?? '') || /[\w.!(:]/.test(text[to] ?? ''))
      continue;
    return { start: from, end: to };
  }

  // Point mode begins after an operator or argument separator. A completed
  // expression still commits normally when the user clicks elsewhere.
  if (!/[=+\-*/^&<>,;({:]\s*$/.test(text.slice(0, start))) return;
  if (start === end && /^[\w.$!'"]/.test(text.slice(end))) return;
  return { start, end };
}

export function formulaRangeReference(selection: CellSelection) {
  const { top, bottom, left, right } = selectionBounds(selection);
  const first = cellAddress({ row: top, column: left });
  const last = cellAddress({ row: bottom, column: right });
  return first === last ? first : `${first}:${last}`;
}
