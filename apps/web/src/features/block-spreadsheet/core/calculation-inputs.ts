import type { SpreadsheetCell, SpreadsheetCells } from './spreadsheet-document';

export type CalculationCells = Record<
  string,
  Pick<SpreadsheetCell, 'value' | 'format' | 'decimals'>
>;

/** Keep appearance edits out of the calculation dependency graph. */
export function calculationInputs(
  cells: SpreadsheetCells,
  previous: CalculationCells
): CalculationCells {
  const next: CalculationCells = {};
  let unchanged = true;
  for (const [address, cell] of Object.entries(cells)) {
    const format = cell.format ?? 'general';
    const decimals = cell.decimals ?? -1;
    // Formatting an otherwise empty cell must not trigger calculation. Keep
    // number formats, though: a blank source cell can display an array spill.
    if (cell.value === '' && format === 'general' && decimals === -1) continue;
    next[address] = { value: cell.value, format, decimals };
    const prior = previous[address];
    if (
      !prior ||
      prior.value !== cell.value ||
      prior.format !== format ||
      prior.decimals !== decimals
    ) {
      unchanged = false;
    }
  }
  return unchanged && Object.keys(next).length === Object.keys(previous).length
    ? previous
    : next;
}

export type CalculationWorkbookInput = {
  id: string;
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
};

/** Preserve each sheet's calculation identity across formatting and layout edits. */
export function workbookCalculationInputs(
  sheets: CalculationWorkbookInput[],
  previous: CalculationWorkbookInput[]
): CalculationWorkbookInput[] {
  const previousById = new Map(previous.map((sheet) => [sheet.id, sheet]));
  const next = sheets.map((sheet) => {
    const prior = previousById.get(sheet.id);
    const cells = calculationInputs(sheet.cells, prior?.cells ?? {});
    return prior &&
      prior.name === sheet.name &&
      prior.rowCount === sheet.rowCount &&
      cells === prior.cells
      ? prior
      : { ...sheet, cells };
  });
  return next.length === previous.length &&
    next.every((sheet, index) => sheet === previous[index])
    ? previous
    : next;
}
