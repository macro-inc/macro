import { format as formatExcelNumber } from 'ssf';
import type {
  SpreadsheetCell,
  SpreadsheetFormat,
} from './spreadsheet-document';

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
  if (format === 'accounting') {
    // Excel's accounting sections: the symbol stays outside the parentheses
    // and only an exact zero shows a dash.
    if (number === 0) return '$-';
    const amount = numberFormatter('number', decimals).format(Math.abs(number));
    return number < 0 ? `$(${amount})` : `$${amount}`;
  }
  return numberFormatter(format, decimals).format(number);
}

function numberFormatter(
  format: SpreadsheetFormat,
  decimals: number
): Intl.NumberFormat {
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
  return formatter;
}

/**
 * An accounting display as Excel lays it out across the cell: the symbol at
 * the left edge and the amount at the right. `padding` is hidden text after
 * the amount that lines positives and zero's dash up with negatives' closing
 * parenthesis. Undefined when the display does not start with a symbol, as
 * some imported accounting formats place it after the amount.
 */
export function accountingParts(
  display: string,
  decimals = -1
): { symbol: string; amount: string; padding: string } | undefined {
  const match = /^\s*([^\d\s().,-]+)\s*(\S.*?)\s*$/.exec(display);
  if (!match) return;
  const [, symbol, amount] = match;
  const padding =
    amount === '-'
      ? `${'0'.repeat(decimals < 0 ? 2 : decimals)})`
      : amount.endsWith(')')
        ? ''
        : ')';
  return { symbol, amount, padding };
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
