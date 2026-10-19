import {
  boundsSqref,
  type DataValidation,
  type DropdownColor,
  MAX_SHEET_RULES,
  sqrefBounds,
  subtractBounds,
  validDataValidation,
} from './sheet-rules';
import { parseCellAddress } from './spreadsheet-document';

// Document colors, light enough for dark chip text. New choices take them in turn.
export const DROPDOWN_CHOICE_COLORS = [
  { value: '#bfdbfe', name: 'Blue' },
  { value: '#bbf7d0', name: 'Green' },
  { value: '#fef08a', name: 'Yellow' },
  { value: '#fecaca', name: 'Red' },
  { value: '#e9d5ff', name: 'Purple' },
  { value: '#fed7aa', name: 'Orange' },
  { value: '#99f6e4', name: 'Teal' },
  { value: '#fbcfe8', name: 'Pink' },
  { value: '#e5e7eb', name: 'Gray' },
] as const;

/** Excel rejects a literal list longer than this, quotes included. */
export const MAX_LIST_FORMULA_LENGTH = 255;
export const MAX_LIST_ITEMS = 1_000;

/** Where a dropdown's choices come from: typed items or a range of cells. */
export type DropdownSource = { items: string[] } | { range: string };

export type DropdownOptions = DropdownSource & {
  /** Reject entries that are not one of the choices; defaults to true. */
  rejectInvalid?: boolean;
  /** Cells showing one of these choices draw it as a chip of its color. */
  colors?: DropdownColor[];
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

/** Choice colors, each naming one of `items` when the choices are typed. */
function choiceColors(colors: DropdownColor[], items?: string[]) {
  if (colors.length > MAX_LIST_ITEMS)
    throw new Error(`A dropdown can color at most ${MAX_LIST_ITEMS} choices.`);
  const choices =
    items && new Set(items.map((item) => item.trim().toLowerCase()));
  const colored = new Set<string>();
  return colors.map(({ item, color }) => {
    const name = item.trim();
    const key = name.toLowerCase();
    if (!name) throw new Error('A dropdown color needs the choice it colors.');
    if (!/^#[0-9a-f]{6}$/i.test(color))
      throw new Error(`Invalid color “${color}” for “${name}”. Use #RRGGBB.`);
    if (choices && !choices.has(key))
      throw new Error(`“${name}” is not one of the dropdown's choices.`);
    if (colored.has(key))
      throw new Error(`“${name}” is given more than one color.`);
    colored.add(key);
    return { item: name, color: color.toLowerCase() };
  });
}

/** A list rule offering a dropdown, as Excel stores it. */
export function dropdownRule(
  options: DropdownOptions
): Omit<DataValidation, 'range'> {
  const strict = options.rejectInvalid ?? true;
  const colors = options.colors?.length
    ? choiceColors(
        options.colors,
        'items' in options ? options.items : undefined
      )
    : undefined;
  return {
    type: 'list',
    formulas: [
      'items' in options
        ? listFormula(options.items)
        : rangeFormula(options.range),
    ],
    allowBlank: true,
    ...(strict && { showError: true, errorStyle: 'stop' as const }),
    ...(colors && { colors }),
  };
}

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
      areas = areas.flatMap((area) => subtractBounds(area, hole));
    if (areas.length) next.push({ ...existing, range: boundsSqref(areas) });
  }
  if (rule) next.push({ ...rule, range: boundsSqref(holes) });
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
