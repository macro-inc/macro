import {
  type DropdownOptions,
  literalListItems,
  validationReference,
} from '@macro-inc/spreadsheet/data-validation';
import {
  type ComparisonOperator,
  type DataValidation,
  sqrefContains,
} from '@macro-inc/spreadsheet/sheet-rules';
import { formatCellAddress, parseCellAddress } from './spreadsheet-document';

/** The validation rule of a cell: Excel applies one rule per cell. */
export function validationAt(
  validations: DataValidation[] | undefined,
  address: string
): DataValidation | undefined {
  const position = parseCellAddress(address);
  if (!position) return;
  return validations?.find((rule) =>
    sqrefContains(rule.range, position.row, position.column)
  );
}

/** A list rule as the dropdown dialog edits it. */
export function dropdownOptions(
  rule: DataValidation | undefined
): DropdownOptions | undefined {
  const source = rule?.type === 'list' ? rule.formulas?.[0] : undefined;
  if (!rule || source === undefined) return;
  const rejectInvalid =
    !!rule.showError && (rule.errorStyle ?? 'stop') === 'stop';
  const items = literalListItems(source);
  return items
    ? { items, rejectInvalid }
    : { range: source.replace(/\$/g, ''), rejectInvalid };
}

/** A cell's displayed text, and its number when it holds one. */
export type RangeValue = { text: string; number?: number };

/** Reads the values of a range, on a named sheet or the rule's own. */
export type RangeValues = (
  sheet: string | undefined,
  range: string
) => RangeValue[] | undefined;

/**
 * A list rule's choices: the items of a quoted list, or the values of a
 * range or a name that refers to one. Undefined when the list comes from a
 * formula Macro does not resolve, such as INDIRECT.
 */
export function listItems(
  rule: DataValidation,
  values: RangeValues,
  names: { name: string; formula: string }[] = []
): string[] | undefined {
  if (rule.type !== 'list') return;
  const source = rule.formulas?.[0]?.trim();
  if (!source) return;
  const literal = literalListItems(source);
  if (literal) return literal;
  const name = names.find(
    (entry) => entry.name.toLowerCase() === source.toLowerCase()
  );
  const target = validationReference(
    name ? name.formula.replace(/^=/, '') : source
  );
  if (!target) return;
  const items = values(target.sheet, target.range);
  if (!items) return;
  // Excel's dropdown shows each value once, without blanks.
  return [...new Set(items.map((item) => item.text.trim()).filter(Boolean))];
}

export type ValidationOutcome =
  | { valid: true }
  | {
      valid: false;
      style: 'stop' | 'warning' | 'information';
      title?: string;
      message: string;
    };

const DAY_MILLISECONDS = 86_400_000;
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * A typed number, percentage, currency amount, date (ISO or month/day/year)
 * or time as Excel's value.
 */
function numericInput(input: string): number | undefined {
  const text = input.trim().replace(/^\+/, '');
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
    return Number(text);
  let match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(text);
  if (match) return Number(match[1]) / 100;
  match = /^(-?)[$€£]?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(text);
  if (match)
    return Number(`${match[1]}${match[2].replace(/,/g, '')}${match[3] ?? ''}`);
  match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match)
    return (
      (Date.UTC(+match[1], +match[2] - 1, +match[3]) - SERIAL_EPOCH) /
      DAY_MILLISECONDS
    );
  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = +match[3] < 100 ? 2000 + +match[3] : +match[3];
    return (
      (Date.UTC(year, +match[1] - 1, +match[2]) - SERIAL_EPOCH) /
      DAY_MILLISECONDS
    );
  }
  match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (match)
    return (+match[1] * 3600 + +match[2] * 60 + +(match[3] ?? 0)) / 86_400;
}

/** A bound written as a number, date or single-cell reference. */
function bound(formula: string | undefined, values: RangeValues) {
  if (formula === undefined) return;
  const direct = numericInput(formula.replace(/^"(.*)"$/, '$1'));
  if (direct !== undefined) return direct;
  const target = validationReference(formula);
  if (!target || target.range.includes(':')) return;
  const value = values(target.sheet, target.range)?.[0];
  return value?.number ?? (value && numericInput(value.text));
}

function compare(
  value: number,
  operator: ComparisonOperator,
  first: number,
  second: number | undefined
) {
  switch (operator) {
    case 'between':
      return (
        second !== undefined &&
        value >= Math.min(first, second) &&
        value <= Math.max(first, second)
      );
    case 'notBetween':
      return (
        second !== undefined &&
        (value < Math.min(first, second) || value > Math.max(first, second))
      );
    case 'equal':
      return value === first;
    case 'notEqual':
      return value !== first;
    case 'greaterThan':
      return value > first;
    case 'lessThan':
      return value < first;
    case 'greaterThanOrEqual':
      return value >= first;
    case 'lessThanOrEqual':
      return value <= first;
  }
}

/**
 * Whether typed input satisfies a cell's rule, as Excel checks it when the
 * rule shows an error alert. Clearing a cell, formulas and rules Macro cannot
 * evaluate (custom formulas, unresolved lists and bounds) are accepted.
 */
export function validateInput(
  rule: DataValidation | undefined,
  input: string,
  values: RangeValues,
  names?: { name: string; formula: string }[]
): ValidationOutcome {
  if (
    !rule?.showError ||
    rule.type === 'any' ||
    rule.type === 'custom' ||
    input.trim() === '' ||
    input.startsWith('=')
  )
    return { valid: true };
  let valid = true;
  if (rule.type === 'list') {
    const items = listItems(rule, values, names);
    valid =
      !items ||
      items.some((item) => item.toLowerCase() === input.trim().toLowerCase());
  } else {
    const operator = rule.operator ?? 'between';
    const first = bound(rule.formulas?.[0], values);
    const second = bound(rule.formulas?.[1], values);
    if (first === undefined) return { valid: true };
    const value =
      rule.type === 'textLength' ? input.length : numericInput(input);
    valid =
      value !== undefined &&
      (rule.type !== 'whole' || Number.isInteger(value)) &&
      compare(value, operator, first, second);
  }
  if (valid) return { valid: true };
  return {
    valid: false,
    style: rule.errorStyle ?? 'stop',
    ...(rule.errorTitle && { title: rule.errorTitle }),
    message:
      rule.error ??
      "This value doesn't match the data validation restrictions defined for this cell.",
  };
}

/** Addresses of a range, for reading its values. */
export function rangeAddresses(range: string): string[] {
  const [first, last = first] = range.split(':').map(parseCellAddress);
  if (!first || !last) return [];
  const addresses: string[] = [];
  for (let row = first.row; row <= last.row && addresses.length < 1_000; row++)
    for (
      let column = first.column;
      column <= last.column && addresses.length < 1_000;
      column++
    )
      addresses.push(formatCellAddress(row, column));
  return addresses;
}
