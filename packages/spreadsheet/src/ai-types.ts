import type { SpreadsheetCellStyle } from './spreadsheet-document';

export type SpreadsheetCellInput = { address: string; value: string };
export type SpreadsheetOverride = {
  sheetId: string;
  cells: SpreadsheetCellInput[];
};
export type SpreadsheetOperation =
  | { type: 'set_cells'; sheetId: string; cells: SpreadsheetCellInput[] }
  | {
      type: 'format_cells';
      sheetId: string;
      range: string;
      style: SpreadsheetCellStyle;
    }
  | {
      type: 'clear_cells';
      sheetId: string;
      range: string;
      clearFormatting?: boolean;
    }
  | {
      type: 'fill_cells';
      sheetId: string;
      sourceRange: string;
      targetRange: string;
    }
  | { type: 'add_sheet'; name: string }
  | { type: 'rename_sheet'; sheetId: string; name: string }
  | { type: 'duplicate_sheet'; sheetId: string; name?: string }
  | { type: 'delete_sheet'; sheetId: string }
  | { type: 'append_rows'; sheetId: string; count: number }
  | {
      type: 'resize_columns';
      sheetId: string;
      columns: { column: string; width: number }[];
    };

export type SpreadsheetReadRequest = {
  action: 'read';
  sheetId?: string;
  ranges?: string[];
  includeStyles?: boolean;
};
export type SpreadsheetCalculateRequest = {
  action: 'calculate';
  sheetId?: string;
  formulas: { label?: string; formula: string }[];
  overrides?: SpreadsheetOverride[];
};
export type SpreadsheetEditRequest = {
  action: 'edit';
  expectedRevision: string;
  operations: SpreadsheetOperation[];
};
export type SpreadsheetRequest =
  | SpreadsheetReadRequest
  | SpreadsheetCalculateRequest
  | SpreadsheetEditRequest;

export type SpreadsheetValue = {
  type: 'blank' | 'number' | 'text' | 'boolean' | 'error';
  value: string | number | boolean | null;
  display: string;
  error?: string;
};
export type SpreadsheetReadCell = SpreadsheetValue & {
  address: string;
  source: string;
  formula?: string;
  style?: SpreadsheetCellStyle;
};
export type SpreadsheetSheetSummary = {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  usedRange: string | null;
  populatedCells: number;
  formulaCells: number;
  errorCells: number;
};
export type SpreadsheetReadRange = {
  sheetId: string;
  sheetName: string;
  range: string;
  cells: SpreadsheetReadCell[];
  truncated: boolean;
};
export type SpreadsheetReadResponse = {
  action: 'read';
  revision: string;
  sheets: SpreadsheetSheetSummary[];
  ranges: SpreadsheetReadRange[];
  warnings: string[];
};
export type SpreadsheetCalculateResponse = {
  action: 'calculate';
  revision: string;
  results: (SpreadsheetValue & { label?: string; formula: string })[];
  warnings: string[];
};
export type SpreadsheetEditResponse = {
  action: 'edit';
  revision: string;
  applied: boolean;
  changes: {
    type: SpreadsheetOperation['type'];
    sheetId: string;
    summary: string;
    range?: string;
  }[];
  sheets: SpreadsheetSheetSummary[];
  warnings: string[];
};
export type SpreadsheetResponse =
  | SpreadsheetReadResponse
  | SpreadsheetCalculateResponse
  | SpreadsheetEditResponse;
