import type { CompletionContext } from '@ironcalc/wasm';
import type { WorkbookSheetMetadata } from '@macro-inc/spreadsheet/workbook-metadata';
import type { AxisChange } from '@macro-inc/spreadsheet/workbook-structure';
import type {
  CalculatedCell,
  CalculationContext,
  CalculationSheet,
  CellCopy,
  SpreadsheetCalculation,
  WorkbookCalculation,
} from './calculation';
import type { CalculationCells } from './calculation-inputs';
import type {
  SpreadsheetCellEdits,
  SpreadsheetCells,
} from './spreadsheet-document';
import type { SpreadsheetWorkbookSheet } from './workbook-document';

/** One sheet of an incremental workbook update. Sheets that are not listed
 * are removed from the worker's copy. */
export type CalculationSheetPatch = {
  id: string;
  name: string;
  rowCount: number;
  metadata?: Pick<
    WorkbookSheetMetadata,
    'definedNames' | 'arrayFormulas' | 'hiddenRows'
  >;
  /** Every input, replacing the worker's copy of the sheet. */
  cells?: CalculationCells;
  /** Changed inputs; null removes a cell. */
  changes?: Record<string, CalculationCells[string] | null>;
};

export type CalculationRequest =
  | {
      id: number;
      type: 'change-axis';
      sheets: SpreadsheetWorkbookSheet[];
      change: AxisChange;
    }
  | { id: number; type: 'calculate'; cells: SpreadsheetCells; rowCount: number }
  | { id: number; type: 'calculate-workbook'; sheets: CalculationSheet[] }
  | { id: number; type: 'update-workbook'; sheets: CalculationSheetPatch[] }
  | {
      id: number;
      type: 'copy';
      copies: CellCopy[];
      context?: CalculationContext;
    }
  | {
      id: number;
      type: 'complete';
      text: string;
      cursor: number;
      context?: CalculationContext;
    };

export type CalculationResponse =
  | { id: number; type: 'change-axis'; sheets: SpreadsheetWorkbookSheet[] }
  | { id: number; type: 'started' }
  | { id: number; type: 'calculate'; values: SpreadsheetCalculation }
  | { id: number; type: 'calculate-workbook'; values: WorkbookCalculation }
  | {
      id: number;
      type: 'update-workbook';
      /** Changed results per sheet; null removes a result. */
      values: Record<string, Record<string, CalculatedCell | null>>;
      /** Sheets whose results replace any previous ones entirely. */
      replaced: string[];
    }
  | { id: number; type: 'copy'; edits: SpreadsheetCellEdits }
  | { id: number; type: 'complete'; context: CompletionContext }
  | { id: number; type: 'error'; message: string };

export type CalculationOperation =
  | Omit<Extract<CalculationRequest, { type: 'change-axis' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'calculate' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'calculate-workbook' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'update-workbook' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'copy' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'complete' }>, 'id'>;
