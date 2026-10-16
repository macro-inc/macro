import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../../database/core/database-view';

/** One cell of a pipeline row, in the shared grid's terms. */
export type PipelineEntryCell = {
  column: DatabaseViewColumn;
  value: DatabaseCellValue;
};

/** A pipeline row that references a company or contact. */
export type PipelineEntry = {
  rowId: string;
  pipeline: {
    id: string;
    name: string;
    tableId: string;
    shared: boolean;
    canEdit: boolean;
  };
  /** Every cell but the reference to the record itself, in column order. */
  cells: PipelineEntryCell[];
};

/** The record whose pipeline entries are shown. */
export type PipelineEntryRecord = { type: 'company' | 'contact'; id: string };
