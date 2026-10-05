import { format as formatExcelNumber } from 'ssf';
import type { SpreadsheetCell } from './spreadsheet-document';

const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});
const DAY_MILLISECONDS = 86_400_000;
export const numericLiteral =
  /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/** A number as a cell with Macro's own format shows it. */
export function displayNumber(number: number, cell?: SpreadsheetCell): string {
  const format = cell?.format ?? 'general';
  if (format === 'date') {
    // Excel's serial calendar contains a fictitious 29 February 1900. Keep
    // that compatibility day while converting actual dates without a timezone shift.
    const day = Math.floor(number);
    if (day === 60) return '2/29/1900';
    const date = new Date(
      Date.UTC(1899, 11, 31) + (day - (day > 60 ? 1 : 0)) * DAY_MILLISECONDS
    );
    return Number.isFinite(date.getTime())
      ? dateFormatter.format(date)
      : '#NUM!';
  }
  if (format === 'time') {
    const fraction = ((number % 1) + 1) % 1;
    return timeFormatter.format(
      new Date(Math.round(fraction * 86_400) * 1_000)
    );
  }
  const decimals = cell?.decimals ?? -1;
  const key = `${format}:${decimals}`;
  let formatter = numberFormatters.get(key);
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {};
    if (format === 'currency') {
      options.style = 'currency';
      options.currency = 'USD';
    } else if (format === 'percent') options.style = 'percent';
    else if (format === 'scientific') options.notation = 'scientific';
    if (format === 'general' || format === 'text') options.useGrouping = false;
    if (decimals >= 0) {
      options.minimumFractionDigits = decimals;
      options.maximumFractionDigits = decimals;
    } else if (format === 'general' || format === 'text') {
      options.maximumSignificantDigits = 15;
    } else {
      options.minimumFractionDigits = format === 'percent' ? 0 : 2;
      options.maximumFractionDigits = 2;
    }
    formatter = new Intl.NumberFormat('en-US', options);
    numberFormatters.set(key, formatter);
  }
  return formatter.format(number);
}

/** A cell's number when it holds a literal one rather than a formula or text. */
export function literalNumber(
  cell: SpreadsheetCell | undefined
): number | undefined {
  if (!cell || cell.format === 'text' || !numericLiteral.test(cell.value))
    return;
  const number = Number(cell.value);
  return Number.isFinite(number) ? number : undefined;
}

/**
 * A literal number as calculation will show it, so imported dates, currency
 * and percentages read correctly before the first calculation finishes.
 * Undefined for other cells and for formats that cannot be displayed.
 */
export function literalNumberDisplay(
  cell: SpreadsheetCell | undefined
): string | undefined {
  const number = literalNumber(cell);
  if (number === undefined) return;
  if (!cell?.numberFormat) return displayNumber(number, cell);
  try {
    return formatExcelNumber(cell.numberFormat, number);
  } catch {
    return;
  }
}
