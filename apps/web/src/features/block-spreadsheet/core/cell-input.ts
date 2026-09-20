import type { SpreadsheetCell } from './spreadsheet-document';

const numericInput = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

function isPercentCell(cell?: SpreadsheetCell) {
  if (cell?.format === 'text') return false;
  if (!cell?.numberFormat) return cell?.format === 'percent';
  // A quoted or escaped percent sign is a literal label, not a scale factor.
  const format = cell.numberFormat.replace(
    /"[^"]*"|\\.|_.|\*.|\[[^\]]*\]/g,
    ''
  );
  return format.includes('%');
}

/** User input in percentage cells uses percentage points; API/import values stay raw. */
export function normalizeCellInput(value: string, cell?: SpreadsheetCell) {
  const trimmed = value.trim();
  return isPercentCell(cell) &&
    numericInput.test(trimmed) &&
    Number.isFinite(Number(trimmed))
    ? `${trimmed}%`
    : value;
}

/** Show an existing numeric percentage in the editor without changing its value. */
export function cellEditValue(cell?: SpreadsheetCell) {
  const value = cell?.value ?? '';
  if (!isPercentCell(cell) || !numericInput.test(value.trim())) return value;
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return value;
  // Spreadsheets display 15 significant decimal digits. Rounding here also
  // avoids exposing binary float artifacts such as 0.07 * 100 = 7.000000000001.
  return `${Number(percent.toPrecision(15))}%`;
}
