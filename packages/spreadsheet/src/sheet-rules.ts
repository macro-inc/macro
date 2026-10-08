import { parseCellAddress } from './spreadsheet-document';

/**
 * Sheet rules imported from Excel and kept in sheet metadata: notes,
 * data validation and conditional formatting. They use Excel's own
 * vocabulary so that they export back unchanged.
 */

export const MAX_SHEET_NOTES = 5_000;
export const MAX_NOTE_LENGTH = 10_000;
export const MAX_SHEET_RULES = 500;
const MAX_FORMULA_LENGTH = 4_096;
const MAX_TEXT_LENGTH = 1_024;

/** One cell or range in A1 notation, within the grid. */
function validRange(range: string): boolean {
  const parts = range.split(':');
  const first = parseCellAddress(parts[0]);
  const last = parseCellAddress(parts[1] ?? parts[0]);
  return (
    parts.length <= 2 &&
    !!first &&
    !!last &&
    first.row <= last.row &&
    first.column <= last.column
  );
}

/** Excel's sqref: one or more ranges separated by spaces, such as `A2:A9 C2`. */
export function validSqref(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8_192 &&
    value.split(' ').every(validRange)
  );
}

/** The ranges of a sqref, as zero-based bounds. */
export function sqrefBounds(sqref: string) {
  return sqref.split(' ').flatMap((range) => {
    const [first, last = first] = range.split(':').map(parseCellAddress);
    return first && last
      ? [
          {
            top: first.row,
            left: first.column,
            bottom: last.row,
            right: last.column,
          },
        ]
      : [];
  });
}

export function sqrefContains(sqref: string, row: number, column: number) {
  return sqrefBounds(sqref).some(
    (bounds) =>
      row >= bounds.top &&
      row <= bounds.bottom &&
      column >= bounds.left &&
      column <= bounds.right
  );
}

const COMPARISON_OPERATORS = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const DATA_VALIDATION_TYPES = [
  /** Any value: Excel's "none", kept for its input message. */
  'any',
  'list',
  'whole',
  'decimal',
  'date',
  'time',
  'textLength',
  'custom',
] as const;

/** An Excel data validation rule. Formulas are stored without `=`. */
export type DataValidation = {
  range: string;
  type: (typeof DATA_VALIDATION_TYPES)[number];
  operator?: ComparisonOperator;
  /** formula1 and, for between and notBetween, formula2. */
  formulas?: string[];
  allowBlank?: boolean;
  /** False when Excel hides the list's in-cell dropdown. */
  dropdown?: boolean;
  errorStyle?: 'stop' | 'warning' | 'information';
  showError?: boolean;
  errorTitle?: string;
  error?: string;
  showPrompt?: boolean;
  promptTitle?: string;
  prompt?: string;
};

export const CONDITIONAL_FORMAT_TYPES = [
  'cellIs',
  'expression',
  'containsText',
  'notContainsText',
  'beginsWith',
  'endsWith',
  'timePeriod',
  'duplicateValues',
  'uniqueValues',
  'containsBlanks',
  'notContainsBlanks',
  'containsErrors',
  'notContainsErrors',
  'aboveAverage',
  'top10',
  'colorScale',
  'dataBar',
  'iconSet',
] as const;

export const TIME_PERIODS = [
  'today',
  'yesterday',
  'tomorrow',
  'last7Days',
  'thisWeek',
  'lastWeek',
  'nextWeek',
  'thisMonth',
  'lastMonth',
  'nextMonth',
] as const;

/** The differential format a matching rule applies. Colors are #RRGGBB. */
export type ConditionalStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textColor?: string;
  fillColor?: string;
  numberFormat?: string;
};

/** A color scale, data bar or icon set threshold: Excel's cfvo. */
export type ConditionalThreshold = {
  type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'formula';
  value?: string;
  /** Icon sets: false when the value must exceed the threshold. */
  gte?: boolean;
};

/** An Excel conditional formatting rule; the sheet's list is in priority
 * order, highest first. */
export type ConditionalFormat = {
  range: string;
  type: (typeof CONDITIONAL_FORMAT_TYPES)[number];
  operator?: ComparisonOperator;
  formulas?: string[];
  text?: string;
  period?: (typeof TIME_PERIODS)[number];
  rank?: number;
  percent?: boolean;
  bottom?: boolean;
  below?: boolean;
  style?: ConditionalStyle;
  stopIfTrue?: boolean;
  thresholds?: ConditionalThreshold[];
  /** Color scale stops, or a data bar's color. */
  colors?: string[];
  iconSet?: string;
  reverse?: boolean;
  showValue?: boolean;
};

const color = (value: unknown) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const text = (value: unknown, limit = MAX_TEXT_LENGTH) =>
  typeof value === 'string' && value.length <= limit;
const flag = (value: unknown) =>
  value === undefined || typeof value === 'boolean';
const optional = (value: unknown, valid: (value: unknown) => boolean) =>
  value === undefined || valid(value);
const formulas = (value: unknown) =>
  Array.isArray(value) &&
  value.length >= 1 &&
  value.length <= 2 &&
  value.every((formula) => text(formula, MAX_FORMULA_LENGTH));
const onlyKeys = (value: object, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A differential format: what a rule or a pivot table area applies. */
export function validConditionalStyle(value: unknown) {
  return (
    record(value) &&
    onlyKeys(value, [
      'bold',
      'italic',
      'underline',
      'strikethrough',
      'textColor',
      'fillColor',
      'numberFormat',
    ]) &&
    flag(value.bold) &&
    flag(value.italic) &&
    flag(value.underline) &&
    flag(value.strikethrough) &&
    optional(value.textColor, color) &&
    optional(value.fillColor, color) &&
    optional(value.numberFormat, (format) => text(format, 255))
  );
}

function validThreshold(value: unknown) {
  return (
    record(value) &&
    onlyKeys(value, ['type', 'value', 'gte']) &&
    ['min', 'max', 'num', 'percent', 'percentile', 'formula'].includes(
      value.type as string
    ) &&
    optional(value.value, (formula) => text(formula, MAX_FORMULA_LENGTH)) &&
    flag(value.gte)
  );
}

export function validConditionalFormat(value: unknown) {
  return (
    record(value) &&
    onlyKeys(value, [
      'range',
      'type',
      'operator',
      'formulas',
      'text',
      'period',
      'rank',
      'percent',
      'bottom',
      'below',
      'style',
      'stopIfTrue',
      'thresholds',
      'colors',
      'iconSet',
      'reverse',
      'showValue',
    ]) &&
    validSqref(value.range) &&
    (CONDITIONAL_FORMAT_TYPES as readonly unknown[]).includes(value.type) &&
    optional(value.operator, (operator) =>
      (COMPARISON_OPERATORS as readonly unknown[]).includes(operator)
    ) &&
    optional(value.formulas, formulas) &&
    optional(value.text, text) &&
    optional(value.period, (period) =>
      (TIME_PERIODS as readonly unknown[]).includes(period)
    ) &&
    optional(
      value.rank,
      (rank) => Number.isInteger(rank) && (rank as number) > 0
    ) &&
    flag(value.percent) &&
    flag(value.bottom) &&
    flag(value.below) &&
    optional(value.style, validConditionalStyle) &&
    flag(value.stopIfTrue) &&
    optional(
      value.thresholds,
      (thresholds) =>
        Array.isArray(thresholds) &&
        thresholds.length <= 5 &&
        thresholds.every(validThreshold)
    ) &&
    optional(
      value.colors,
      (colors) =>
        Array.isArray(colors) && colors.length <= 3 && colors.every(color)
    ) &&
    optional(value.iconSet, (name) => text(name, 32)) &&
    flag(value.reverse) &&
    flag(value.showValue)
  );
}

export function validDataValidation(value: unknown) {
  return (
    record(value) &&
    onlyKeys(value, [
      'range',
      'type',
      'operator',
      'formulas',
      'allowBlank',
      'dropdown',
      'errorStyle',
      'showError',
      'errorTitle',
      'error',
      'showPrompt',
      'promptTitle',
      'prompt',
    ]) &&
    validSqref(value.range) &&
    (DATA_VALIDATION_TYPES as readonly unknown[]).includes(value.type) &&
    optional(value.operator, (operator) =>
      (COMPARISON_OPERATORS as readonly unknown[]).includes(operator)
    ) &&
    optional(value.formulas, formulas) &&
    flag(value.allowBlank) &&
    flag(value.dropdown) &&
    optional(value.errorStyle, (style) =>
      ['stop', 'warning', 'information'].includes(style as string)
    ) &&
    flag(value.showError) &&
    optional(value.errorTitle, (title) => text(title, 64)) &&
    optional(value.error, text) &&
    flag(value.showPrompt) &&
    optional(value.promptTitle, (title) => text(title, 64)) &&
    optional(value.prompt, text)
  );
}

export function validNotes(value: unknown) {
  if (!record(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_SHEET_NOTES &&
    entries.every(
      ([address, note]) =>
        !!parseCellAddress(address) &&
        typeof note === 'string' &&
        note.length > 0 &&
        note.length <= MAX_NOTE_LENGTH
    )
  );
}
