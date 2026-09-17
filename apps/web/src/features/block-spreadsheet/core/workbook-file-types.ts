import type { SpreadsheetCalculation } from './calculation';
import type { SpreadsheetCells } from './spreadsheet-document';

export const XLSX_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
export const XLSX_MAX_SHEETS = 10;
export const XLSX_OPERATION_TIMEOUT_MS = 30_000;

/** Decoding never writes to a document; callers preview warnings before applying. */
export type WorkbookFileSheet = {
  name: string;
  cells: SpreadsheetCells;
  rowCount: number;
  columnWidths: Record<number, number>;
  values?: SpreadsheetCalculation;
};
export type WorkbookFileData = {
  sheets: WorkbookFileSheet[];
  warnings: string[];
};
export type WorkbookFileExport = { bytes: Uint8Array; warnings: string[] };
export type WorkbookFileRequest =
  | { kind: 'decode'; bytes: Uint8Array }
  | { kind: 'encode'; workbook: Pick<WorkbookFileData, 'sheets'> };
export type WorkbookFileReply =
  | { kind: 'decoded'; workbook: WorkbookFileData }
  | { kind: 'encoded'; file: WorkbookFileExport }
  | { kind: 'error'; message: string };
