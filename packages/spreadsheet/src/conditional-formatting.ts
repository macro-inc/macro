import {
  type CfRuleInput,
  type Cfvo,
  type Dxf,
  getIconSetIcons,
  type Icon,
  type Model,
} from '@ironcalc/wasm';
import {
  type ConditionalFormat,
  type ConditionalStyle,
  type ConditionalThreshold,
  sqrefBounds,
} from './sheet-rules';
import { formatCellAddress } from './spreadsheet-document';

/**
 * How conditional formatting changes a cell, as the engine evaluated it: the
 * matching rules' formats, and a data bar or an icon. Colors are #RRGGBB.
 */
export type ConditionalAppearance = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  textColor?: string;
  fillColor?: string;
  /** `value` and `axis` are fractions of the cell's width. */
  dataBar?: {
    value: number;
    axis: number;
    color: string;
    negativeColor: string;
    gradient: boolean;
  };
  icon?: { name: Icon; color: string };
  /** False when a data bar or icon replaces the cell's value. */
  showValue?: boolean;
};

/** Cells the engine evaluates rules over, at most, per workbook. */
const MAX_CONDITIONAL_CELLS = 1_000_000;

const TIME_PERIODS = {
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  last7Days: 'Last7Days',
  thisWeek: 'ThisWeek',
  lastWeek: 'LastWeek',
  nextWeek: 'NextWeek',
  thisMonth: 'ThisMonth',
  lastMonth: 'LastMonth',
  nextMonth: 'NextMonth',
} as const;

const TEXT_OPERATORS = {
  containsText: 'Contains',
  notContainsText: 'DoesNotContain',
  beginsWith: 'BeginsWith',
  endsWith: 'EndsWith',
} as const;

const COMPARISONS = {
  equal: '=',
  notEqual: '<>',
  greaterThan: '>',
  lessThan: '<',
  greaterThanOrEqual: '>=',
  lessThanOrEqual: '<=',
} as const;

function differentialFormat(style: ConditionalStyle = {}): Dxf {
  const dxf: Dxf = {};
  const font: NonNullable<Dxf['font']> = {};
  if (style.bold !== undefined) font.b = style.bold;
  if (style.italic !== undefined) font.i = style.italic;
  if (style.underline !== undefined) font.u = style.underline;
  if (style.strikethrough !== undefined) font.strike = style.strikethrough;
  if (style.textColor) font.color = style.textColor;
  if (Object.keys(font).length) dxf.font = font;
  if (style.fillColor) dxf.fill = { color: style.fillColor };
  return dxf;
}

function threshold({ type, value }: ConditionalThreshold): Cfvo {
  const number = Number(value);
  const numeric =
    value !== undefined && value !== '' && Number.isFinite(number);
  if (type === 'min') return 'Min';
  if (type === 'max') return 'Max';
  if (type === 'formula' || !numeric) return { Formula: value ?? '0' };
  if (type === 'percent') return { Percent: number };
  if (type === 'percentile') return { Percentile: number };
  return { Number: number };
}

/**
 * The engine's form of a rule. Comparisons become formulas over the rule's
 * first cell, as Excel evaluates them: they compare text too, and their
 * formulas may use relative references.
 */
export function engineRule(rule: ConditionalFormat): CfRuleInput | undefined {
  const format = differentialFormat(rule.style);
  const stop_if_true = rule.stopIfTrue ?? false;
  const bounds = sqrefBounds(rule.range);
  if (!bounds.length) return;
  const cell = formatCellAddress(
    Math.min(...bounds.map((range) => range.top)),
    Math.min(...bounds.map((range) => range.left))
  );
  const [first, second] = rule.formulas ?? [];
  switch (rule.type) {
    case 'cellIs': {
      if (first === undefined || !rule.operator) return;
      let formula: string;
      if (rule.operator === 'between' || rule.operator === 'notBetween') {
        if (second === undefined) return;
        const low = `MIN((${first}),(${second}))`;
        const high = `MAX((${first}),(${second}))`;
        formula =
          rule.operator === 'between'
            ? `AND(${cell}>=${low},${cell}<=${high})`
            : `OR(${cell}<${low},${cell}>${high})`;
      } else formula = `${cell}${COMPARISONS[rule.operator]}(${first})`;
      return { type: 'Formula', formula, format, stop_if_true };
    }
    case 'expression':
      return first === undefined
        ? undefined
        : { type: 'Formula', formula: first, format, stop_if_true };
    case 'containsText':
    case 'notContainsText':
    case 'beginsWith':
    case 'endsWith':
      return rule.text === undefined
        ? undefined
        : {
            type: 'Text',
            operator: TEXT_OPERATORS[rule.type],
            value: rule.text,
            format,
            stop_if_true,
          };
    case 'timePeriod':
      return rule.period
        ? {
            type: 'TimePeriod',
            time_period: TIME_PERIODS[rule.period],
            date1: null,
            date2: null,
            format,
            stop_if_true,
          }
        : undefined;
    case 'duplicateValues':
      return { type: 'DuplicateValues', format, stop_if_true };
    case 'uniqueValues':
      return { type: 'UniqueValues', format, stop_if_true };
    case 'containsBlanks':
      return { type: 'Blanks', format, stop_if_true };
    case 'notContainsBlanks':
      return { type: 'NotBlanks', format, stop_if_true };
    case 'containsErrors':
      return { type: 'Errors', format, stop_if_true };
    case 'notContainsErrors':
      return { type: 'NoErrors', format, stop_if_true };
    case 'aboveAverage':
      return {
        type: rule.below ? 'BelowAverage' : 'AboveAverage',
        format,
        stop_if_true,
      };
    case 'top10':
      return {
        type: rule.bottom ? 'Bottom10' : 'Top10',
        rank: rule.rank ?? 10,
        percent: rule.percent ?? false,
        format,
        stop_if_true,
      };
    case 'colorScale': {
      const thresholds = rule.thresholds ?? [];
      const colors = rule.colors ?? [];
      if (thresholds.length < 2 || colors.length !== thresholds.length) return;
      return {
        type: 'ColorScale',
        thresholds: thresholds.map((value, index) => ({
          cfvo: threshold(value),
          color: colors[index],
        })),
      };
    }
    case 'dataBar': {
      const [low, high] = rule.thresholds ?? [];
      return {
        type: 'DataBar',
        min: low ? threshold(low) : null,
        max: high ? threshold(high) : null,
        positive_color: rule.colors?.[0] ?? '#638EC6',
        negative_color: '#FF0000',
        is_gradient: true,
        show_value: rule.showValue ?? true,
      };
    }
    case 'iconSet': {
      const icons = getIconSetIcons(rule.iconSet ?? '3TrafficLights1');
      const thresholds = rule.thresholds ?? [];
      if (!icons || icons.length !== thresholds.length) return;
      if (rule.reverse) icons.reverse();
      return {
        type: 'IconSet',
        thresholds: thresholds.map((value, index) => ({
          icon: icons[index][0],
          color: icons[index][1],
          cfvo: threshold(value),
          is_strict: value.gte ?? true,
        })),
        show_value: rule.showValue ?? true,
      };
    }
  }
}

/** The rule's ranges within the sheet's grid, or undefined if none remain. */
function gridRange(range: string, rows: number, columns: number) {
  let cells = 0;
  const parts = sqrefBounds(range).flatMap((bounds) => {
    const bottom = Math.min(bounds.bottom, rows - 1);
    const right = Math.min(bounds.right, columns - 1);
    if (bounds.top > bottom || bounds.left > right) return [];
    cells += (bottom - bounds.top + 1) * (right - bounds.left + 1);
    return [
      `${formatCellAddress(bounds.top, bounds.left)}:${formatCellAddress(bottom, right)}`,
    ];
  });
  return parts.length ? { range: parts.join(' '), cells } : undefined;
}

/**
 * Give a sheet's conditional formatting rules to the engine, in priority
 * order, within its grid. Returns how many cells they cover. Rules the
 * engine cannot read are left out: they still export.
 */
export function addConditionalFormats(
  model: Model,
  sheetIndex: number,
  rules: ConditionalFormat[] | undefined,
  rows: number,
  columns: number,
  budget = MAX_CONDITIONAL_CELLS
): number {
  let used = 0;
  for (const rule of rules ?? []) {
    const area = gridRange(rule.range, rows, columns);
    const input = area && engineRule(rule);
    if (!area || !input || used + area.cells > budget) continue;
    try {
      model.addConditionalFormatting(sheetIndex, area.range, input);
      used += area.cells;
    } catch {
      // An invalid formula: the rule is kept for export only.
    }
  }
  return used;
}

/** Each matched cell's appearance after the last evaluation. */
export function readConditionalAppearance(
  model: Model,
  sheetIndex: number
): Map<string, ConditionalAppearance> {
  const result = new Map<string, ConditionalAppearance>();
  for (const overlay of model.getConditionalFormattingOverlay(sheetIndex)) {
    const appearance: ConditionalAppearance = {};
    if (overlay.bold !== undefined) appearance.bold = overlay.bold;
    if (overlay.italic !== undefined) appearance.italic = overlay.italic;
    if (overlay.underline !== undefined)
      appearance.underline = overlay.underline;
    if (overlay.strike !== undefined) appearance.strikethrough = overlay.strike;
    if (overlay.color) appearance.textColor = overlay.color;
    if (overlay.fill) appearance.fillColor = overlay.fill;
    const bar = overlay.data_bar;
    if (bar && typeof bar.positive_color === 'string') {
      appearance.dataBar = {
        value: bar.value,
        axis: bar.axis_position,
        color: bar.positive_color,
        negativeColor:
          typeof bar.negative_color === 'string'
            ? bar.negative_color
            : '#FF0000',
        gradient: bar.is_gradient,
      };
      if (!bar.show_value) appearance.showValue = false;
    }
    const icon = overlay.icon;
    if (icon && typeof icon.color === 'string') {
      appearance.icon = { name: icon.icon, color: icon.color };
      if (!icon.show_value) appearance.showValue = false;
    }
    if (Object.keys(appearance).length)
      result.set(
        formatCellAddress(overlay.row - 1, overlay.column - 1),
        appearance
      );
  }
  return result;
}
