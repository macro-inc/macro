import {
  CONDITIONAL_FORMAT_TYPES,
  type ComparisonOperator,
  type ConditionalFormat,
  type ConditionalThreshold,
  DATA_VALIDATION_TYPES,
  type DataValidation,
  MAX_SHEET_RULES,
  TIME_PERIODS,
} from '@macro-inc/spreadsheet/sheet-rules';
import {
  formatCellAddress,
  parseCellAddress,
  SPREADSHEET_MAX_COLUMNS,
  SPREADSHEET_MAX_ROWS,
} from './spreadsheet-document';
import type { XlsxStylesheet } from './xlsx-stylesheet';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const STRICT = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const XM = 'http://schemas.microsoft.com/office/excel/2006/main';

type Attributes = Record<string, string>;

const on = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value === '1' || value === 'true';

/** A cell reference's position, including one beyond Macro's grid. */
function position(reference: string) {
  const match = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/i.exec(reference);
  if (!match || match[2].startsWith('0')) return;
  let column = 0;
  for (const letter of match[1].toUpperCase())
    column = column * 26 + letter.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}

/** Excel's sqref within Macro's grid, or undefined when nothing remains. */
export function importSqref(sqref: string | undefined): string | undefined {
  const ranges = (sqref ?? '')
    .trim()
    .split(/\s+/)
    .flatMap((range) => {
      const parts = range.split(':');
      const first = position(parts[0]);
      const last = parts.length === 1 ? first : position(parts[1]);
      if (parts.length > 2 || !first || !last) return [];
      const top = Math.min(first.row, last.row);
      const left = Math.min(first.column, last.column);
      if (top >= SPREADSHEET_MAX_ROWS || left >= SPREADSHEET_MAX_COLUMNS)
        return [];
      const bottom = Math.min(
        Math.max(first.row, last.row),
        SPREADSHEET_MAX_ROWS - 1
      );
      const right = Math.min(
        Math.max(first.column, last.column),
        SPREADSHEET_MAX_COLUMNS - 1
      );
      const start = formatCellAddress(top, left);
      const end = formatCellAddress(bottom, right);
      return [start === end ? start : `${start}:${end}`];
    });
  return ranges.length ? ranges.join(' ') : undefined;
}

/** The cell Excel evaluates a rule's relative references from: the top-left
 * cell of its ranges. */
function anchor(sqref: string) {
  let row = Number.POSITIVE_INFINITY;
  let column = Number.POSITIVE_INFINITY;
  for (const range of sqref.split(' ')) {
    const first = parseCellAddress(range.split(':')[0]);
    if (!first) continue;
    row = Math.min(row, first.row);
    column = Math.min(column, first.column);
  }
  return { row, column };
}

/** Excel 2010 rules Macro reads: those defined by formulas. */
const FORMULA_RULES: ReadonlySet<string> = new Set([
  'expression',
  'cellIs',
  'containsText',
  'notContainsText',
  'beginsWith',
  'endsWith',
  'containsBlanks',
  'notContainsBlanks',
  'containsErrors',
  'notContainsErrors',
  'timePeriod',
]);

const TEXT_RULES: ReadonlySet<string> = new Set([
  'containsText',
  'notContainsText',
  'beginsWith',
  'endsWith',
]);

const THRESHOLD_TYPES: Record<string, ConditionalThreshold['type']> = {
  min: 'min',
  max: 'max',
  num: 'num',
  percent: 'percent',
  percentile: 'percentile',
  formula: 'formula',
  // Excel 2010 data bars: the automatic minimum and maximum.
  autoMin: 'min',
  autoMax: 'max',
};

type Pending = {
  attributes: Attributes;
  formulas: string[];
  thresholds: ConditionalThreshold[];
  colors: string[];
  extension?: boolean;
  sqref?: string;
  /** An Excel 2010 rule's inline format. */
  style?: ConditionalFormat['style'];
};

/**
 * Reads conditional formatting and data validation from a worksheet's
 * elements as the worksheet parser streams them, including the Excel 2010
 * extension list. `formula` imports a formula relative to a cell.
 */
export function createSheetRulesReader(options: {
  styles: XlsxStylesheet;
  warnings: Set<string>;
  formula: (source: string, row: number, column: number) => string | undefined;
}) {
  const { styles, warnings } = options;
  const conditional: { priority: number; rule: ConditionalFormat }[] = [];
  const validations: DataValidation[] = [];
  let sqref: string | undefined;
  let rule: Pending | undefined;
  let validation: Pending | undefined;
  let text: string | undefined;
  let skipped = false;
  // Excel 2010 rules: their ranges follow them, and formats are inline.
  let extensionRules: Pending[] | undefined;
  let extensionRule: Pending | undefined;
  let extensionSqref: string | undefined;
  let differential:
    | {
        reader: ReturnType<XlsxStylesheet['inlineDifferential']>;
        stack: string[];
      }
    | undefined;

  const formulas = (sources: string[], range: string) => {
    const { row, column } = anchor(range);
    const imported: string[] = [];
    for (const source of sources) {
      const formula = options.formula(source, row, column);
      if (formula === undefined) return;
      imported.push(formula);
    }
    return imported;
  };

  function finishRule(pending: Pending, range: string | undefined) {
    const value = pending.attributes;
    let type = value.type as ConditionalFormat['type'];
    // Excel evaluates these rules' formulas. Some writers leave out the text
    // or period they were made from; the formula still defines the rule.
    if (
      pending.formulas.length &&
      ((TEXT_RULES.has(type) && value.text === undefined) ||
        (type === 'timePeriod' &&
          !(TIME_PERIODS as readonly string[]).includes(value.timePeriod)))
    )
      type = 'expression';
    if (
      !range ||
      !(CONDITIONAL_FORMAT_TYPES as readonly string[]).includes(type)
    ) {
      skipped = true;
      return;
    }
    const result: ConditionalFormat = { range, type };
    if (value.operator) {
      // Text operators are implied by the rule type.
      if (type === 'cellIs')
        result.operator = value.operator as ComparisonOperator;
    }
    if (
      pending.formulas.length &&
      (type === 'cellIs' || type === 'expression')
    ) {
      const imported = formulas(pending.formulas.slice(0, 2), range);
      if (!imported) {
        skipped = true;
        return;
      }
      result.formulas = imported;
    } else if (type === 'cellIs' || type === 'expression') {
      skipped = true;
      return;
    }
    if (value.text !== undefined) result.text = value.text;
    if (type === 'timePeriod') {
      if (!(TIME_PERIODS as readonly string[]).includes(value.timePeriod)) {
        skipped = true;
        return;
      }
      result.period = value.timePeriod as ConditionalFormat['period'];
    }
    if (type === 'top10') {
      result.rank = Math.max(1, Math.round(Number(value.rank ?? 10)) || 10);
      if (on(value.percent, false)) result.percent = true;
      if (on(value.bottom, false)) result.bottom = true;
    }
    if (type === 'aboveAverage' && !on(value.aboveAverage, true))
      result.below = true;
    if (['colorScale', 'dataBar', 'iconSet'].includes(type)) {
      if (!pending.thresholds.length) {
        skipped = true;
        return;
      }
      result.thresholds = pending.thresholds;
      if (pending.colors.length) result.colors = pending.colors;
      if (type === 'iconSet') {
        result.iconSet = pending.attributes.iconSet ?? '3TrafficLights1';
        if (on(pending.attributes.reverse, false)) result.reverse = true;
      }
      if (!on(pending.attributes.showValue, true)) result.showValue = false;
    } else {
      const style =
        pending.style ??
        (value.dxfId === undefined
          ? undefined
          : styles.differentialStyle(Number(value.dxfId)));
      if (style && Object.keys(style).length) result.style = style;
    }
    if (on(value.stopIfTrue, false)) result.stopIfTrue = true;
    conditional.push({
      priority: Number(value.priority ?? 0) || 0,
      rule: result,
    });
  }

  function finishValidation(pending: Pending, range: string | undefined) {
    const value = pending.attributes;
    // Any value: only an input message makes it worth keeping.
    const type =
      (value.type ?? 'none') === 'none' ? 'any' : (value.type as string);
    if (type === 'any' && !value.prompt) return;
    if (
      !range ||
      !(DATA_VALIDATION_TYPES as readonly string[]).includes(type)
    ) {
      skipped = true;
      return;
    }
    const imported = formulas(pending.formulas.slice(0, 2), range);
    if (!imported || (type !== 'any' && !imported.length)) {
      skipped = true;
      return;
    }
    const result: DataValidation = {
      range,
      type: type as DataValidation['type'],
      ...(imported.length && { formulas: imported }),
    };
    // Between is Excel's default comparison.
    if (!['any', 'list', 'custom'].includes(type))
      result.operator = (value.operator ?? 'between') as ComparisonOperator;
    if (on(value.allowBlank, false)) result.allowBlank = true;
    // OOXML's showDropDown="1" hides the in-cell dropdown.
    if (on(value.showDropDown, false)) result.dropdown = false;
    if (value.errorStyle === 'warning' || value.errorStyle === 'information')
      result.errorStyle = value.errorStyle;
    if (on(value.showErrorMessage, false)) result.showError = true;
    if (value.errorTitle) result.errorTitle = value.errorTitle.slice(0, 64);
    if (value.error) result.error = value.error.slice(0, 1024);
    if (on(value.showInputMessage, false)) result.showPrompt = true;
    if (value.promptTitle) result.promptTitle = value.promptTitle.slice(0, 64);
    if (value.prompt) result.prompt = value.prompt.slice(0, 1024);
    validations.push(result);
  }

  return {
    /** Returns true when the element was a rule's. */
    open(local: string, uri: string, value: Attributes): boolean {
      if (differential) {
        differential.reader.read(local, differential.stack.at(-1)!, value);
        differential.stack.push(local);
        return true;
      }
      const main = uri === MAIN || uri === STRICT || uri === '';
      if (main && local === 'conditionalFormatting') {
        sqref = importSqref(value.sqref);
        return true;
      }
      if (main && local === 'cfRule') {
        rule = { attributes: value, formulas: [], thresholds: [], colors: [] };
        return true;
      }
      if (uri === X14 && local === 'conditionalFormatting') {
        extensionRules = [];
        extensionSqref = undefined;
        return true;
      }
      if (uri === X14 && local === 'cfRule') {
        // A data bar here extends the main list's rule with the same id.
        if (value.type === 'dataBar') return true;
        if (FORMULA_RULES.has(value.type ?? ''))
          extensionRule = {
            attributes: value,
            formulas: [],
            thresholds: [],
            colors: [],
          };
        else skipped = true;
        return true;
      }
      if (extensionRule && uri === X14 && local === 'dxf') {
        differential = { reader: styles.inlineDifferential(), stack: ['dxf'] };
        return true;
      }
      if (extensionRules && uri === XM && (local === 'f' || local === 'sqref')) {
        text = '';
        return true;
      }
      if (rule && (main || uri === X14) && local === 'cfvo') {
        const type = THRESHOLD_TYPES[value.type ?? ''];
        if (type)
          rule.thresholds.push({
            type,
            ...(value.val !== undefined && { value: value.val }),
            ...(value.gte === '0' && { gte: false }),
          });
        return true;
      }
      if (rule && main && local === 'color') {
        const color = styles.color(value);
        if (color) rule.colors.push(color);
        return true;
      }
      if (rule && main && local === 'iconSet') {
        rule.attributes = { ...rule.attributes, ...value };
        return true;
      }
      if (rule && main && local === 'dataBar') {
        if (value.showValue !== undefined)
          rule.attributes = { ...rule.attributes, showValue: value.showValue };
        return true;
      }
      if (rule && main && local === 'formula') {
        text = '';
        return true;
      }
      if ((main || uri === X14) && local === 'dataValidation') {
        validation = {
          attributes: value,
          formulas: [],
          thresholds: [],
          colors: [],
          extension: uri === X14,
        };
        return true;
      }
      if (
        validation &&
        ((main && (local === 'formula1' || local === 'formula2')) ||
          (uri === XM && local === 'f') ||
          (uri === XM && local === 'sqref'))
      ) {
        text = '';
        return true;
      }
      return false;
    },
    text(chunk: string) {
      if (text !== undefined) text += chunk;
    },
    close(local: string, uri: string) {
      const main = uri === MAIN || uri === STRICT || uri === '';
      if (differential) {
        if (uri === X14 && local === 'dxf') {
          if (extensionRule) extensionRule.style = differential.reader.style();
          differential = undefined;
        } else differential.stack.pop();
        return;
      }
      if (extensionRules) {
        if (uri === XM && local === 'f') {
          extensionRule?.formulas.push(text ?? '');
          text = undefined;
        } else if (uri === XM && local === 'sqref') {
          extensionSqref = text;
          text = undefined;
        } else if (extensionRule && uri === X14 && local === 'cfRule') {
          extensionRules.push(extensionRule);
          extensionRule = undefined;
        } else if (uri === X14 && local === 'conditionalFormatting') {
          const range = importSqref(extensionSqref);
          for (const pending of extensionRules) finishRule(pending, range);
          extensionRules = undefined;
        }
        return;
      }
      if (main && local === 'conditionalFormatting') sqref = undefined;
      else if (rule && main && local === 'formula') {
        rule.formulas.push(text ?? '');
        text = undefined;
      } else if (rule && main && local === 'cfRule') {
        finishRule(rule, sqref);
        rule = undefined;
      } else if (
        validation &&
        main &&
        (local === 'formula1' || local === 'formula2')
      ) {
        validation.formulas.push(text ?? '');
        text = undefined;
      } else if (validation && uri === XM && local === 'f') {
        validation.formulas.push(text ?? '');
        text = undefined;
      } else if (validation && uri === XM && local === 'sqref') {
        validation.sqref = text;
        text = undefined;
      } else if (validation && local === 'dataValidation') {
        finishValidation(
          validation,
          importSqref(
            validation.extension
              ? validation.sqref
              : validation.attributes.sqref
          )
        );
        validation = undefined;
      }
    },
    finish() {
      if (skipped)
        warnings.add(
          'Some conditional formatting and data validation rules could not be imported.'
        );
      const rules = conditional
        .sort((a, b) => a.priority - b.priority)
        .map(({ rule: value }) => value);
      if (
        rules.length > MAX_SHEET_RULES ||
        validations.length > MAX_SHEET_RULES
      )
        warnings.add(
          `Only the first ${MAX_SHEET_RULES} conditional formatting and data validation rules of a sheet are imported.`
        );
      return {
        conditionalFormats: rules.slice(0, MAX_SHEET_RULES),
        validations: validations.slice(0, MAX_SHEET_RULES),
      };
    },
  };
}

// Export -------------------------------------------------------------------

function xml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** An attribute when the value is set. */
function attribute(name: string, value: string | number | undefined) {
  return value === undefined || value === ''
    ? ''
    : ` ${name}="${xml(String(value))}"`;
}

/** The first cell of a rule's ranges, which its formulas are written for. */
function firstCell(range: string) {
  const { row, column } = anchor(range);
  return formatCellAddress(row, column);
}

/** The formulas Excel writes for rules defined by text or by a period. */
function impliedFormula(rule: ConditionalFormat): string | undefined {
  const cell = firstCell(rule.range);
  const text = `"${(rule.text ?? '').replace(/"/g, '""')}"`;
  const day = `FLOOR(${cell},1)`;
  const date = `ROUNDDOWN(${cell},0)`;
  switch (rule.type) {
    case 'containsText':
      return `NOT(ISERROR(SEARCH(${text},${cell})))`;
    case 'notContainsText':
      return `ISERROR(SEARCH(${text},${cell}))`;
    case 'beginsWith':
      return `LEFT(${cell},LEN(${text}))=${text}`;
    case 'endsWith':
      return `RIGHT(${cell},LEN(${text}))=${text}`;
    case 'containsBlanks':
      return `LEN(TRIM(${cell}))=0`;
    case 'notContainsBlanks':
      return `LEN(TRIM(${cell}))>0`;
    case 'containsErrors':
      return `ISERROR(${cell})`;
    case 'notContainsErrors':
      return `NOT(ISERROR(${cell}))`;
    case 'timePeriod':
      return {
        today: `${day}=TODAY()`,
        yesterday: `${day}=TODAY()-1`,
        tomorrow: `${day}=TODAY()+1`,
        last7Days: `AND(TODAY()-${day}<=6,${day}<=TODAY())`,
        thisWeek: `AND(TODAY()-${date}<=WEEKDAY(TODAY())-1,${date}-TODAY()<=7-WEEKDAY(TODAY()))`,
        lastWeek: `AND(TODAY()-${date}>=(WEEKDAY(TODAY())),TODAY()-${date}<(WEEKDAY(TODAY())+7))`,
        nextWeek: `AND(${date}-TODAY()>(7-WEEKDAY(TODAY())),${date}-TODAY()<(15-WEEKDAY(TODAY())))`,
        thisMonth: `AND(MONTH(${cell})=MONTH(TODAY()),YEAR(${cell})=YEAR(TODAY()))`,
        lastMonth: `AND(MONTH(${cell})=MONTH(EDATE(TODAY(),0-1)),YEAR(${cell})=YEAR(EDATE(TODAY(),0-1)))`,
        nextMonth: `AND(MONTH(${cell})=MONTH(EDATE(TODAY(),0+1)),YEAR(${cell})=YEAR(EDATE(TODAY(),0+1)))`,
      }[rule.period ?? 'today'];
  }
}

function thresholdXml(
  threshold: ConditionalThreshold,
  formula: (value: string) => string
) {
  const value =
    threshold.value === undefined
      ? undefined
      : threshold.type === 'formula' ||
          !Number.isFinite(Number(threshold.value))
        ? formula(threshold.value)
        : threshold.value;
  return `<cfvo type="${threshold.type}"${attribute('val', value)}${threshold.gte === false ? ' gte="0"' : ''}/>`;
}

const colorXml = (color: string) =>
  `<color rgb="FF${color.slice(1).toUpperCase()}"/>`;

/**
 * A sheet's `<conditionalFormatting>` elements, in priority order. `dxf`
 * registers a rule's format in the stylesheet; `formula` prepares a formula
 * for Excel.
 */
export function conditionalFormattingXml(
  rules: ConditionalFormat[] | undefined,
  dxf: (style: ConditionalFormat['style']) => number,
  formula: (source: string) => string
): string {
  return (rules ?? [])
    .map((rule, index) => {
      const priority = index + 1;
      let body = '';
      let attributes = `type="${rule.type}" priority="${priority}"`;
      if (['colorScale', 'dataBar', 'iconSet'].includes(rule.type)) {
        const thresholds = (rule.thresholds ?? [])
          .map((threshold) => thresholdXml(threshold, formula))
          .join('');
        const colors = (rule.colors ?? []).map(colorXml).join('');
        if (rule.type === 'colorScale')
          body = `<colorScale>${thresholds}${colors}</colorScale>`;
        else if (rule.type === 'dataBar')
          body = `<dataBar${rule.showValue === false ? ' showValue="0"' : ''}>${thresholds}${colors || colorXml('#638EC6')}</dataBar>`;
        else
          body = `<iconSet${attribute('iconSet', rule.iconSet)}${rule.reverse ? ' reverse="1"' : ''}${rule.showValue === false ? ' showValue="0"' : ''}>${thresholds}</iconSet>`;
      } else {
        attributes += ` dxfId="${dxf(rule.style)}"`;
        if (rule.type === 'cellIs')
          attributes += attribute('operator', rule.operator);
        if (rule.text !== undefined) {
          attributes += attribute(
            'operator',
            {
              containsText: 'containsText',
              notContainsText: 'notContains',
              beginsWith: 'beginsWith',
              endsWith: 'endsWith',
            }[rule.type as string]
          );
          attributes += attribute('text', rule.text);
        }
        if (rule.type === 'timePeriod')
          attributes += attribute('timePeriod', rule.period);
        if (rule.type === 'top10') {
          attributes += attribute('rank', rule.rank ?? 10);
          if (rule.percent) attributes += ' percent="1"';
          if (rule.bottom) attributes += ' bottom="1"';
        }
        if (rule.type === 'aboveAverage' && rule.below)
          attributes += ' aboveAverage="0"';
        const formulas = rule.formulas ?? [];
        const implied = impliedFormula(rule);
        body = [...formulas, ...(formulas.length || !implied ? [] : [implied])]
          .map((source) => `<formula>${xml(formula(source))}</formula>`)
          .join('');
      }
      if (rule.stopIfTrue) attributes += ' stopIfTrue="1"';
      return `<conditionalFormatting sqref="${rule.range}"><cfRule ${attributes}>${body}</cfRule></conditionalFormatting>`;
    })
    .join('');
}

/** A sheet's `<dataValidations>` element, or nothing. */
export function dataValidationsXml(
  validations: DataValidation[] | undefined,
  formula: (source: string) => string
): string {
  if (!validations?.length) return '';
  const items = validations.map((rule) => {
    const formulas = (rule.formulas ?? [])
      .map(
        (source, index) =>
          `<formula${index + 1}>${xml(formula(source))}</formula${index + 1}>`
      )
      .join('');
    return `<dataValidation${rule.type === 'any' ? '' : ` type="${rule.type}"`}${attribute('errorStyle', rule.errorStyle)}${rule.operator ? attribute('operator', rule.operator) : ''}${rule.allowBlank ? ' allowBlank="1"' : ''}${rule.dropdown === false ? ' showDropDown="1"' : ''}${rule.showPrompt ? ' showInputMessage="1"' : ''}${rule.showError ? ' showErrorMessage="1"' : ''}${attribute('errorTitle', rule.errorTitle)}${attribute('error', rule.error)}${attribute('promptTitle', rule.promptTitle)}${attribute('prompt', rule.prompt)} sqref="${rule.range}">${formulas}</dataValidation>`;
  });
  return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

/**
 * A sheet's notes as Excel's comments part and the legacy drawing Excel
 * shows them with. `sheet` is the 1-based sheet number, which keeps the
 * drawing's shape ids unique in the workbook.
 */
export function notesParts(
  notes: Record<string, string> | undefined,
  sheet: number
): { comments: string; drawing: string } | undefined {
  const entries = Object.entries(notes ?? {}).flatMap(([address, note]) => {
    const position = parseCellAddress(address);
    return position ? [{ address, note, ...position }] : [];
  });
  if (!entries.length) return;
  const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<comments xmlns="${MAIN}"><authors><author>Macro</author></authors><commentList>${entries
    .map(
      ({ address, note }) =>
        `<comment ref="${address}" authorId="0"><text><r><t xml:space="preserve">${xml(note)}</t></r></text></comment>`
    )
    .join('')}</commentList></comments>`;
  const shapes = entries
    .map(
      ({ row, column }, index) =>
        `<v:shape id="_x0000_s${sheet * 1024 + index + 1}" type="#_x0000_t202" style="position:absolute;margin-left:59.25pt;margin-top:1.5pt;width:108pt;height:59.25pt;z-index:${index + 1};visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto"><v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"></div></v:textbox><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>${column + 1}, 15, ${row}, 2, ${column + 3}, 15, ${row + 4}, 16</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>${row}</x:Row><x:Column>${column}</x:Column></x:ClientData></v:shape>`
    )
    .join('');
  const drawing = `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="${sheet}"/></o:shapelayout><v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>${shapes}</xml>`;
  return { comments, drawing };
}

/** A conditional format's differential format as a stylesheet `<dxf>`. */
export function differentialXml(
  style: ConditionalFormat['style'] = {},
  numberFormatId?: number
): string {
  const font = [
    style.bold !== undefined && (style.bold ? '<b/>' : '<b val="0"/>'),
    style.italic !== undefined && (style.italic ? '<i/>' : '<i val="0"/>'),
    style.strikethrough !== undefined &&
      (style.strikethrough ? '<strike/>' : '<strike val="0"/>'),
    style.underline !== undefined &&
      (style.underline ? '<u/>' : '<u val="none"/>'),
    style.textColor && colorXml(style.textColor),
  ]
    .filter(Boolean)
    .join('');
  const fill = style.fillColor
    ? `<fill><patternFill><bgColor rgb="FF${style.fillColor.slice(1).toUpperCase()}"/></patternFill></fill>`
    : '';
  const format =
    style.numberFormat && numberFormatId !== undefined
      ? `<numFmt numFmtId="${numberFormatId}"${attribute('formatCode', style.numberFormat)}/>`
      : '';
  return `<dxf>${font ? `<font>${font}</font>` : ''}${format}${fill}</dxf>`;
}
