import { csvImportEdits } from './sheet-operations';
import {
  SPREADSHEET_ROWS,
  type SpreadsheetCells,
} from './spreadsheet-document';
import type { WorkbookFileData } from './workbook-file-types';

export function isUploadedWorkbook(fileType: string | null | undefined) {
  return /^(xlsx|csv)$/i.test(fileType ?? '');
}

/** CSV carries values, not executable formulas or cell types. Keep identifiers
 * and formula-looking text literal; only unambiguous finite numbers are inferred. */
export function decodeCsv(text: string): WorkbookFileData {
  const result = csvImportEdits(text, {
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 },
  });
  const cells: SpreadsheetCells = {};
  for (const [address, edit] of Object.entries(result.edits)) {
    const value = edit?.value ?? '';
    if (value) cells[address] = { value };
  }
  return {
    sheets: [
      {
        name: 'Sheet1',
        cells,
        rowCount: Math.max(SPREADSHEET_ROWS, result.rowCount),
        columnWidths: {},
      },
    ],
    warnings: [],
  };
}
