import { is_date } from 'ssf';
import { parseTypedDate, typedDateText } from './cell-dates';
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

function isDateCell(cell?: SpreadsheetCell) {
  return (
    cell?.format === 'date' ||
    (cell?.format !== 'text' &&
      !!cell?.numberFormat &&
      is_date(cell.numberFormat))
  );
}

/**
 * The edit for what a user typed into a cell. Percentage cells take
 * percentage points, and a date becomes its serial number shown as a date:
 * in the cell's own date format, or else in one like the typed text.
 * API and import values stay raw.
 */
export function cellInputEdit(
  value: string,
  cell: SpreadsheetCell | undefined,
  locale: string
): Partial<SpreadsheetCell> {
  if (cell?.format === 'text') return { value };
  const trimmed = value.trim();
  if (
    isPercentCell(cell) &&
    numericInput.test(trimmed) &&
    Number.isFinite(Number(trimmed))
  )
    return { value: `${trimmed}%` };
  const date = parseTypedDate(value, locale);
  if (!date) return { value };
  if (isDateCell(cell)) return { value: String(date.serial) };
  return {
    value: String(date.serial),
    format: 'date',
    ...(date.numberFormat && { numberFormat: date.numberFormat }),
  };
}

/** Show an existing number the way it would be typed: dates as dates, and
 * percentages without changing their value. */
export function cellEditValue(
  cell: SpreadsheetCell | undefined,
  locale: string
) {
  const value = cell?.value ?? '';
  if (isDateCell(cell) && numericInput.test(value.trim()))
    return typedDateText(Number(value), locale) ?? value;
  if (!isPercentCell(cell) || !numericInput.test(value.trim())) return value;
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return value;
  // Spreadsheets display 15 significant decimal digits. Rounding here also
  // avoids exposing binary float artifacts such as 0.07 * 100 = 7.000000000001.
  return `${Number(percent.toPrecision(15))}%`;
}
