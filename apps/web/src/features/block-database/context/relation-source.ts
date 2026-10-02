import type { DatabaseSqlFailure } from '@core/database-sql/driver';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import type { DatabaseRelatedRow } from '../core/database-relations';

/** The related table's schema could not be read, or its rows could not. */
export type DatabaseRelationFailure =
  | { kind: 'table-unavailable' }
  | DatabaseSqlFailure;

export type DatabaseRelationSource = {
  name: Accessor<string>;
  rows: Accessor<DatabaseRelatedRow[]>;
  loading: Accessor<boolean>;
  error: Accessor<string | undefined>;
  refresh: () => ResultAsync<void, DatabaseRelationFailure>;
};
