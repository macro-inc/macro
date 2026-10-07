import type { WorkbookSheetMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import type { SpreadsheetCalculation } from './calculation';
import type { SpreadsheetCells } from './spreadsheet-document';

export const XLSX_MAX_BYTES = 50 * 1024 * 1024;
export const XLSX_MAX_EXPANDED_BYTES = 400 * 1024 * 1024;
export const XLSX_MAX_ENTRIES = 10_000;
export const XLSX_MAX_SHEETS = 300;
/** Populated cells across a workbook; beyond this, browsers run out of memory. */
export const XLSX_MAX_CELLS = 2_000_000;
export const XLSX_OPERATION_TIMEOUT_MS = 120_000;
/** CSV files and exports from accounting tools can be large; parse up to this. */
export const CSV_MAX_BYTES = 20 * 1024 * 1024;

/** Decoding never writes to a document; callers preview warnings before applying. */
export type WorkbookFileSheet = {
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
  columnCount?: number;
  columnWidths: Record<number, number>;
  values?: SpreadsheetCalculation;
  metadata?: WorkbookSheetMetadata;
};
export type WorkbookFileData = {
  sheets: WorkbookFileSheet[];
  warnings: string[];
  /** Images the sheets draw, as data URLs by content key. */
  images?: Record<string, string>;
};
export type WorkbookFileExport = { bytes: Uint8Array; warnings: string[] };
export type WorkbookFileRequest =
  | { kind: 'decode'; bytes: Uint8Array }
  | { kind: 'encode'; workbook: Pick<WorkbookFileData, 'sheets' | 'images'> };
export type WorkbookFileReply =
  | { kind: 'decoded'; workbook: WorkbookFileData }
  | { kind: 'encoded'; file: WorkbookFileExport }
  | { kind: 'error'; message: string };
