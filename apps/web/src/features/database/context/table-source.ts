import type { DatabaseOpsError } from '@service-storage/databases';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type {
  Catalog,
  DatabaseView,
  Outcome,
} from '../../../lib/core/database-sql/generated/types';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRow, DatabaseRowMutation } from '../core/table';
import type {
  DatabaseReadFailure,
  DatabaseWriteFailure,
} from '../core/write-failure';

export type DatabaseRowsSnapshot = {
  /** The rows the view's statement returned, in its order. */
  rows: DatabaseRow[];
  /** Rows the view holds on to by id, such as an open record, in or out of the view. */
  retained: DatabaseRow[];
  version: number | undefined;
};
export type DatabaseWriteResult = {
  insertedRowIds: string[];
  version: number | undefined;
};

export type DatabaseRowsPagination = {
  hasMore: Accessor<boolean>;
  loading: Accessor<boolean>;
  version: Accessor<number | undefined>;
  loadMore(): ResultAsync<unknown, DatabaseReadFailure>;
};

/** Rows are undefined before the first successful read; background errors may coexist with them. */
export type DatabaseRowsSource = {
  pagination?: DatabaseRowsPagination;
  columns: Accessor<DatabaseViewColumn[]>;
  snapshot: Accessor<DatabaseRowsSnapshot | undefined>;
  /** The view's last read as the engine answered it. */
  read?: Accessor<
    { outcome: Outcome; catalog: Catalog; view: DatabaseView } | undefined
  >;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  error: Accessor<DatabaseReadFailure | undefined>;
  refresh(
    reason?: 'after-write' | 'refresh'
  ): ResultAsync<void, DatabaseReadFailure>;
  /**
   * `inferenceBaseVersion` is the table version a new column's type is
   * settled against from its first value; ops themselves carry no version.
   * `createOptions` lets labels a column lacks become new options.
   */
  write(
    mutation: DatabaseRowMutation,
    inferenceBaseVersion: number | undefined,
    createOptions: boolean
  ): ResultAsync<DatabaseWriteResult, DatabaseWriteFailure>;
  addOption(
    columnId: string,
    label: string
  ): ResultAsync<void, DatabaseOpsError>;
  /** Keep reading these rows by id, whether or not the view shows them. */
  retain(rowIds: Accessor<readonly string[]>): void;
};
