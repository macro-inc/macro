import type { SpreadsheetCell } from './spreadsheet-document';

export type SpreadsheetCommand =
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-values'
  | 'clear-values'
  | 'clear-formatting'
  | 'fill-down'
  | 'fill-right'
  | 'select-all'
  | 'find'
  | 'export-csv'
  | 'export-xlsx'
  | 'import'
  | 'add-rows'
  | 'toggle-gridlines'
  | 'toggle-formula-bar'
  | 'toggle-formulas'
  | 'sort-asc'
  | 'sort-desc'
  | 'trim-whitespace'
  | 'border-all'
  | 'border-outer'
  | 'border-none'
  | 'insert-sum'
  | 'insert-average'
  | 'insert-count'
  | 'insert-min'
  | 'insert-max';

export type SpreadsheetToolbarProps = {
  readonly: boolean;
  onComment?: () => void;
  canComment?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  cell: SpreadsheetCell | undefined;
  zoom: number;
  showGridlines: boolean;
  showFormulaBar: boolean;
  showFormulas: boolean;
  onStyle: (patch: Partial<Omit<SpreadsheetCell, 'value'>>) => void;
  onZoom: (percent: number) => void;
  onRestoreFocus?: () => void;
  onCommand: (command: SpreadsheetCommand) => void;
};

export const SPREADSHEET_ZOOM_LEVELS = [50, 75, 90, 100, 125, 150, 200];

export const SPREADSHEET_FUNCTIONS = [
  { name: 'SUM', command: 'insert-sum', description: 'Add values' },
  { name: 'AVERAGE', command: 'insert-average', description: 'Mean of values' },
  { name: 'COUNT', command: 'insert-count', description: 'Count numbers' },
  { name: 'MIN', command: 'insert-min', description: 'Smallest value' },
  { name: 'MAX', command: 'insert-max', description: 'Largest value' },
] as const;

export const SPREADSHEET_NUMBER_FORMATS = [
  { value: 'general', label: 'Automatic', example: '1,234.5' },
  { value: 'number', label: 'Number', example: '1,234.00' },
  { value: 'currency', label: 'Currency', example: '$1,234.00' },
  { value: 'percent', label: 'Percent', example: '12.50%' },
  { value: 'date', label: 'Date', example: '9/17/2026' },
  { value: 'time', label: 'Time', example: '12:30 PM' },
  { value: 'scientific', label: 'Scientific', example: '1.23E+03' },
  { value: 'text', label: 'Plain text', example: '1234' },
] as const;
