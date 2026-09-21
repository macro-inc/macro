import type { Accessor } from 'solid-js';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow, DatabaseRowMutation } from '../core/table';

export type DatabaseRowsSnapshot = {
  rows: DatabaseRow[];
  version: number | undefined;
};
export type DatabaseWriteResult = {
  insertedRowIds: string[];
  version: number | undefined;
};

/** Rows are undefined before the first successful read; background errors may coexist with them. */
export type DatabaseRowsSource = {
  columns: Accessor<DatabaseViewColumn[]>;
  snapshot: Accessor<DatabaseRowsSnapshot | undefined>;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  error: Accessor<Error | undefined>;
  refresh(): Promise<void>;
  write(
    mutation: DatabaseRowMutation,
    version: number | undefined
  ): Promise<DatabaseWriteResult>;
  addOption(columnId: string, label: string): Promise<void>;
};

export class DatabaseWriteConflict extends Error {}

/** A create request may have committed before its response was lost. */
export class DatabaseWriteOutcomeUnknown extends Error {}
