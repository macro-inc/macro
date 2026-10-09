import type {
  DatabaseOp,
  OpResult,
  ViewQuery,
} from '@core/database-sql/generated/types';
import type { DatabaseOpsError } from '@service-storage/databases';
import type { ResultAsync } from 'neverthrow';
import type { DatabaseViewColumn } from './database-view';
import type { DatabaseRow } from './table';
import type { DatabaseReadFailure } from './write-failure';

/** Schema consumed by the editor, independent of property storage and app entities. */
export type DatabaseTableSchema = {
  id: string;
  databaseId: string;
  name: string;
  version: number;
  columns: DatabaseViewColumn[];
};

/** The existing database operation protocol, shared by every host. */
export type DatabaseOpBatch = {
  ops: DatabaseOp[];
  baseVersions?: Record<string, number>;
};
export type DatabaseAppliedOps = { results: OpResult[] };
export type DatabaseRowRequest = {
  tableId: string;
  query: ViewQuery;
  cursor?: string;
  /** Read retained records even when they no longer match the current query. */
  rowIds?: string[];
};
export type DatabaseRowPage = {
  rows: DatabaseRow[];
  nextCursor?: string;
  tableVersion: number;
};

/** Transport boundary. Adapters own routes, authentication and DTO conversion. */
export type DatabaseApi = {
  key: readonly string[];
  readTable(
    tableId: string
  ): ResultAsync<DatabaseTableSchema, DatabaseReadFailure>;
  readRows(
    request: DatabaseRowRequest
  ): ResultAsync<DatabaseRowPage, DatabaseReadFailure>;
  applyOps(
    batch: DatabaseOpBatch
  ): ResultAsync<DatabaseAppliedOps, DatabaseOpsError>;
};

/** UI permissions are advisory; the host service authorizes every operation. */
export type DatabaseCapabilities = {
  editRows: boolean;
  editColumns: boolean;
};
