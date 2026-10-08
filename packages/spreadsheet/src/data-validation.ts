import {
  type DataValidation,
  MAX_SHEET_RULES,
  sqrefBounds,
  validDataValidation,
} from './sheet-rules';
import { formatCellAddress, parseCellAddress } from './spreadsheet-document';

/** Excel rejects a literal list longer than this, quotes included. */
export const MAX_LIST_FORMULA_LENGTH = 255;
export const MAX_LIST_ITEMS = 1_000;

/** Where a dropdown's choices come from: typed items or a range of cells. */
export type DropdownSource = { items: string[] } | { range: string };

export type DropdownOptions = DropdownSource & {
  /** Reject entries that are not one of the choices; defaults to true. */
  rejectInvalid?: boolean;
};

const reference =
  /^(?:(?:'((?:[^']|'')+)'|([^\s!'"(),:]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i;

/** A validation formula that is a single reference: its sheet and plain A1 range. */
export function validationReference(formula: string) {
  const match = reference.exec(formula.trim());
  if (!match) return;
  const [, quoted, bare, column1, row1, column2, row2] = match;
  const start = `${column1}${row1}`.toUpperCase();
  const end = column2 ? `${column2}${row2}`.toUpperCase() : start;
  const first = parseCellAddress(start);
  const last = parseCellAddress(end);
  if (!first || !last || first.row > last.row || first.column > last.column)
    return;
  return {
    sheet: quoted?.replace(/''/g, "'") ?? bare,
    range: start === end ? start : `${start}:${end}`,
  };
}

/** The items of a quoted list formula such as `"Open,Done"`. */
export function literalListItems(formula: string): string[] | undefined {
  const source = formula.trim();
  if (!/^".*"$/s.test(source)) return;
  return source
    .slice(1, -1)
    .replace(/""/g, '"')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function listFormula(items: string[]) {
  const unique = [...new Set(items.map((item) => item.trim()))];
  if (!unique.length || unique.some((item) => !item))
    throw new Error('A dropdown needs at least one non-empty choice.');
  if (unique.length > MAX_LIST_ITEMS)
    throw new Error(`A dropdown can list at most ${MAX_LIST_ITEMS} choices.`);
  if (unique.some((item) => item.includes(',')))
    throw new Error(
      'Typed dropdown choices cannot contain commas. List them in cells and use a range instead.'
    );
  const formula = `"${unique.join(',').replace(/"/g, '""')}"`;
  if (formula.length > MAX_LIST_FORMULA_LENGTH)
    throw new Error(
      `Typed dropdown choices are limited to ${MAX_LIST_FORMULA_LENGTH - 2} characters in total. List them in cells and use a range instead.`
    );
  return formula;
}

function rangeFormula(range: string) {
  const target = validationReference(range);
  if (!target)
    throw new Error(
      `Invalid dropdown source “${range}”. Use a range such as A2:A10 or 'Sheet 2'!A2:A10.`
    );
  const absolute = target.range
    .split(':')
    .map((address) => address.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'))
    .join(':');
  if (target.sheet === undefined) return absolute;
  return `'${target.sheet.replaceAll("'", "''")}'!${absolute}`;
}

/** A list rule offering a dropdown, as Excel stores it. */
export function dropdownRule(
  options: DropdownOptions
): Omit<DataValidation, 'range'> {
  const strict = options.rejectInvalid ?? true;
  return {
    type: 'list',
    formulas: [
      'items' in options
        ? listFormula(options.items)
        : rangeFormula(options.range),
    ],
    allowBlank: true,
    ...(strict && { showError: true, errorStyle: 'stop' as const }),
  };
}

type Bounds = { top: number; left: number; bottom: number; right: number };

/** The rules covering any cell of `range`. */
export function overlappingValidations(
  validations: DataValidation[] | undefined,
  range: string
): DataValidation[] {
  const areas = sqrefBounds(range);
  return (validations ?? []).filter((rule) =>
    sqrefBounds(rule.range).some((bounds) =>
      areas.some(
        (area) =>
          bounds.top <= area.bottom &&
          bounds.bottom >= area.top &&
          bounds.left <= area.right &&
          bounds.right >= area.left
      )
    )
  );
}

/** The parts of `area` outside `hole`. */
function subtract(area: Bounds, hole: Bounds): Bounds[] {
  if (
    hole.top > area.bottom ||
    hole.bottom < area.top ||
    hole.left > area.right ||
    hole.right < area.left
  )
    return [area];
  const pieces: Bounds[] = [];
  const top = Math.max(area.top, hole.top);
  const bottom = Math.min(area.bottom, hole.bottom);
  if (area.top < hole.top) pieces.push({ ...area, bottom: hole.top - 1 });
  if (area.bottom > hole.bottom) pieces.push({ ...area, top: hole.bottom + 1 });
  if (area.left < hole.left)
    pieces.push({ top, bottom, left: area.left, right: hole.left - 1 });
  if (area.right > hole.right)
    pieces.push({ top, bottom, left: hole.right + 1, right: area.right });
  return pieces;
}

function sqrefOf(bounds: Bounds[]) {
  return bounds
    .map((area) => {
      const first = formatCellAddress(area.top, area.left);
      const last = formatCellAddress(area.bottom, area.right);
      return first === last ? first : `${first}:${last}`;
    })
    .join(' ');
}

/**
 * Validations with `range` taken out of every rule, then `rule` applied to
 * it. A cell has one rule, so a new rule replaces those it overlaps; without
 * a rule the range is cleared.
 */
export function replaceValidations(
  validations: DataValidation[] | undefined,
  range: string,
  rule?: Omit<DataValidation, 'range'>
): DataValidation[] {
  const holes = sqrefBounds(range);
  if (!holes.length) throw new Error(`Invalid range “${range}”.`);
  const next: DataValidation[] = [];
  for (const existing of validations ?? []) {
    let areas = sqrefBounds(existing.range);
    for (const hole of holes)
      areas = areas.flatMap((area) => subtract(area, hole));
    if (areas.length) next.push({ ...existing, range: sqrefOf(areas) });
  }
  if (rule) next.push({ ...rule, range: sqrefOf(holes) });
  if (next.length > MAX_SHEET_RULES)
    throw new Error(
      `A sheet can have at most ${MAX_SHEET_RULES} data validation rules.`
    );
  if (!next.every(validDataValidation))
    throw new Error(
      'These cells split existing data validation into too many ranges. Choose a simpler range.'
    );
  return next;
}
