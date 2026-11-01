import type { ChartTypeId } from './chart-builder';
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
  | 'dropdown'
  | 'table'
  | 'goal-seek'
  | 'custom-date-format'
  | 'border-all'
  | 'border-outer'
  | 'border-none'
  | 'indent-decrease'
  | 'indent-increase'
  | 'insert-sum'
  | 'insert-average'
  | 'insert-count'
  | 'insert-min'
  | 'insert-max'
  | 'insert-checkbox'
  | 'remove-checkbox';

export type SpreadsheetToolbarProps = {
  readonly: boolean;
  onComment?: () => void;
  canComment?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  cell: SpreadsheetCell | undefined;
  /** Whether the active cell is in a table, whose options the menu offers. */
  inTable?: boolean;
  zoom: number;
  showGridlines: boolean;
  showFormulaBar: boolean;
  showFormulas: boolean;
  onStyle: (patch: Partial<Omit<SpreadsheetCell, 'value'>>) => void;
  onZoom: (percent: number) => void;
  onRestoreFocus?: () => void;
  onCommand: (command: SpreadsheetCommand) => void;
  /** Insert a chart of the selected cells, or of their table. */
  onInsertChart?: (type: ChartTypeId) => void;
  onInsertImage?: () => void;
  /** Select the sheet's first image or chart, when it has one. */
  onSelectDrawings?: () => void;
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
  { value: 'accounting', label: 'Accounting', example: '$ (1,234.00)' },
  { value: 'percent', label: 'Percent', example: '12.50%' },
  { value: 'date', label: 'Date', example: '9/17/2026' },
  { value: 'time', label: 'Time', example: '12:30 PM' },
  { value: 'scientific', label: 'Scientific', example: '1.23E+03' },
  { value: 'text', label: 'Plain text', example: '1234' },
] as const;

/** Excel date codes offered beside the default Date format, with how each
 * shows Thursday, 17 September 2026. */
export const SPREADSHEET_DATE_FORMATS = [
  { numberFormat: 'mmm yyyy', example: 'Sep 2026' },
  { numberFormat: 'mmm dd, yyyy', example: 'Sep 17, 2026' },
  { numberFormat: 'mm/dd/yyyy', example: '09/17/2026' },
  { numberFormat: 'dd/mm/yyyy', example: '17/09/2026' },
  { numberFormat: 'yyyy-mm-dd', example: '2026-09-17' },
  { numberFormat: 'd mmm yyyy', example: '17 Sep 2026' },
  {
    numberFormat: 'dddd, mmmm d, yyyy',
    example: 'Thursday, September 17, 2026',
  },
] as const;
