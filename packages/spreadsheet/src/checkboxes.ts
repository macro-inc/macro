import {
  type CellSelection,
  selectionAddresses,
  selectionBounds,
} from './grid-selection';
import {
  parseCellAddress,
  type SpreadsheetCell,
  type SpreadsheetCellEdits,
  type SpreadsheetCells,
} from './spreadsheet-document';

/**
 * Whether a checkbox cell showing this text is checked: TRUE is, FALSE and
 * blank are not. Any other value is shown as text, as Excel shows it.
 */
export function checkboxChecked(display: string): boolean | undefined {
  if (!display || /^false$/i.test(display)) return false;
  if (/^true$/i.test(display)) return true;
}

/** A checkbox the user can toggle: one whose source is TRUE, FALSE or blank. */
function toggleState(cell: SpreadsheetCell) {
  return cell.value.startsWith('=') ? undefined : checkboxChecked(cell.value);
}

/** The checkbox cells inside a selection, found among the sheet's cells. */
export function selectedCheckboxes(
  cells: SpreadsheetCells,
  selection: CellSelection
) {
  const { top, bottom, left, right } = selectionBounds(selection);
  const found: [string, SpreadsheetCell][] = [];
  for (const address in cells) {
    const cell = cells[address];
    if (!cell.checkbox) continue;
    const position = parseCellAddress(address);
    if (
      position &&
      position.row >= top &&
      position.row <= bottom &&
      position.column >= left &&
      position.column <= right
    )
      found.push([address, cell]);
  }
  return found;
}

/**
 * Insert > Checkbox: every selected cell shows a checkbox. Blank cells start
 * unchecked as FALSE, so formulas count them; other values are kept.
 */
export function insertCheckboxEdits(
  cells: SpreadsheetCells,
  selection: CellSelection
): SpreadsheetCellEdits {
  return Object.fromEntries(
    selectionAddresses(selection).map((address) => [
      address,
      cells[address]?.value
        ? { checkbox: true }
        : { checkbox: true, value: 'FALSE' },
    ])
  );
}

/**
 * Space or a click: checks every selected checkbox, or unchecks them all when
 * all are checked. Formulas and other values are left alone. Undefined when
 * the selection has no checkboxes.
 */
export function toggleCheckboxEdits(
  cells: SpreadsheetCells,
  selection: CellSelection
): SpreadsheetCellEdits | undefined {
  const boxes = selectedCheckboxes(cells, selection);
  if (!boxes.length) return;
  const states = boxes.flatMap(([address, cell]) => {
    const state = toggleState(cell);
    return state === undefined ? [] : [[address, state] as const];
  });
  const value = states.some(([, state]) => !state) ? 'TRUE' : 'FALSE';
  return Object.fromEntries(states.map(([address]) => [address, { value }]));
}

/**
 * Delete, as Excel treats checkboxes: while any selected box is checked,
 * every box is unchecked; otherwise the boxes are removed. Other cells are
 * cleared.
 */
export function deleteCellEdits(
  cells: SpreadsheetCells,
  selection: CellSelection
): SpreadsheetCellEdits {
  const edits: SpreadsheetCellEdits = Object.fromEntries(
    selectionAddresses(selection).map((address) => [address, { value: '' }])
  );
  const boxes = selectedCheckboxes(cells, selection);
  const uncheck = boxes.some(([, cell]) => toggleState(cell));
  for (const [address] of boxes)
    edits[address] = uncheck
      ? { value: 'FALSE' }
      : { value: '', checkbox: false };
  return edits;
}
