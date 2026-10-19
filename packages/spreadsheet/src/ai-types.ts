import type { DataValidation, DropdownColor } from './sheet-rules';
import type { TableColumnType } from './sheet-tables';
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
    }
  | {
      type: 'set_dropdown';
      sheetId: string;
      range: string;
      items?: string[];
      source?: string;
      rejectInvalid?: boolean;
      colors?: DropdownColor[];
    }
  | { type: 'clear_validation'; sheetId: string; range: string }
  | { type: 'insert_checkboxes'; sheetId: string; range: string }
  | {
      type: 'create_table';
      sheetId: string;
      range: string;
      name?: string;
      totalsRow?: boolean;
      /** Types by column name; other columns take the type their values
       * suggest. */
      columnTypes?: SpreadsheetTableColumnType[];
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
  tables?: SpreadsheetTableSummary[];
};
/** A named table, which formulas address as `Name[Column]`. */
export type SpreadsheetTableSummary = {
  name: string;
  range: string;
  columns: string[];
  totalsRow: boolean;
  /** Columns whose filters hide rows. */
  filteredColumns?: string[];
  /** Typed columns; untyped columns are left out. */
  columnTypes?: SpreadsheetTableColumnType[];
};
/** A table column's type, by column name. */
export type SpreadsheetTableColumnType = {
  column: string;
  type: TableColumnType;
};
/** A data validation rule overlapping a read range. */
export type SpreadsheetReadValidation = {
  range: string;
  type: DataValidation['type'];
  /** A dropdown's typed choices. */
  items?: string[];
  /** A dropdown's source range, or another rule's formulas. */
  source?: string;
  operator?: DataValidation['operator'];
  formulas?: string[];
  /** Whether a dropdown arrow is shown. */
  dropdown?: boolean;
  /** Whether entries breaking the rule are rejected. */
  rejectInvalid: boolean;
  /** A dropdown's choice colors. */
  colors?: DropdownColor[];
};
export type SpreadsheetReadRange = {
  sheetId: string;
  sheetName: string;
  range: string;
  cells: SpreadsheetReadCell[];
  validations?: SpreadsheetReadValidation[];
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
