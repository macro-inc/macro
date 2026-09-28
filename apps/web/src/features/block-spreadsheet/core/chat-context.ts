import { formulaRangeReference } from './formula-reference';
import { positionFromAddress } from './grid-selection';
import type { SpreadsheetSelection } from './spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from './workbook-document';

/** Snapshot the user's view in the mention without changing the visible prompt. */
export function spreadsheetChatContext(
  sheet: SpreadsheetWorkbookSheet,
  selection: SpreadsheetSelection | undefined
): Record<string, string> {
  const selected = !selection?.sheetId || selection.sheetId === sheet.id;
  const anchor = selected && positionFromAddress(selection?.anchor ?? 'A1');
  const focus = selected && positionFromAddress(selection?.focus ?? 'A1');
  const range =
    anchor &&
    focus &&
    anchor.row < sheet.layout.rowCount &&
    focus.row < sheet.layout.rowCount
      ? formulaRangeReference({ anchor, focus })
      : 'A1';
  return { sheetId: sheet.id, sheetName: sheet.name, range };
}
