import type { CompletionContext } from '@ironcalc/wasm';
import type {
  CalculationContext,
  CalculationSheet,
  CellCopy,
  SpreadsheetCalculation,
  WorkbookCalculation,
} from './calculation';
import type {
  SpreadsheetCellEdits,
  SpreadsheetCells,
} from './spreadsheet-document';

export type CalculationRequest =
  | { id: number; type: 'calculate'; cells: SpreadsheetCells; rowCount: number }
  | { id: number; type: 'calculate-workbook'; sheets: CalculationSheet[] }
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
  | { id: number; type: 'started' }
  | { id: number; type: 'calculate'; values: SpreadsheetCalculation }
  | { id: number; type: 'calculate-workbook'; values: WorkbookCalculation }
  | { id: number; type: 'copy'; edits: SpreadsheetCellEdits }
  | { id: number; type: 'complete'; context: CompletionContext }
  | { id: number; type: 'error'; message: string };

export type CalculationOperation =
  | Omit<Extract<CalculationRequest, { type: 'calculate' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'calculate-workbook' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'copy' }>, 'id'>
  | Omit<Extract<CalculationRequest, { type: 'complete' }>, 'id'>;
