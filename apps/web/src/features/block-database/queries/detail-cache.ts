/** The cached database detail, patched as schema, option and view ops are sent and read again when one is refused. */
import type { DatabaseOp } from '@core/database-sql/generated/types';
import { queryClient } from '@queries/client';
import { applyDatabaseOps } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import type { QueryClient } from '@tanstack/solid-query';
import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import type { DatabaseOpFailure } from '../../database/core/write-failure';

/**
 * Change the cached detail in place; nothing happens before it is first read.
 * An in-flight read is cancelled first so its older answer cannot land over
 * the change.
 */
export async function patchDetail(
  databaseId: string,
  change: (detail: DatabaseDetail) => DatabaseDetail
): Promise<() => void> {
  const queryKey = databasesKeys.detail(databaseId).queryKey;
  await queryClient.cancelQueries({ queryKey, exact: true });
  const previous = queryClient.getQueryData<DatabaseDetail>(queryKey);
  const optimistic = queryClient.setQueryData<DatabaseDetail>(
    queryKey,
    (current) => current && change(current)
  );
  return () => {
    // Never restore a snapshot over a newer edit or server read.
    if (previous && queryClient.getQueryData(queryKey) === optimistic)
      queryClient.setQueryData(queryKey, previous);
    void queryClient.invalidateQueries({ queryKey });
  };
}

/** Optimistically change one table before sending its operation. */
export function patchTable(
  databaseId: string,
  tableId: string,
  change: (table: TableDetail) => TableDetail
): Promise<() => void> {
  return patchDetail(databaseId, (detail) => ({
    ...detail,
    tables: detail.tables.map((table) =>
      table.table.id === tableId ? change(table) : table
    ),
  }));
}

/** Change one table's cached views. */
export async function patchViews(
  databaseId: string,
  tableId: string,
  change: (views: DatabaseView[]) => DatabaseView[]
): Promise<void> {
  await patchDetail(databaseId, (detail) => ({
    ...detail,
    tables: detail.tables.map((table) =>
      table.table.id === tableId
        ? { ...table, views: change(table.views) }
        : table
    ),
  }));
}

/**
 * Change one cached column as the service answered it, at the table version
 * it answered with. A cached table already past that version may hold a
 * later change to the column, so it is left alone. An in-flight read is
 * cancelled first so its older answer cannot land over the change.
 */
export async function patchTableColumn(
  client: QueryClient,
  params: {
    databaseId: string;
    tableId: string;
    columnId: string;
    tableVersion: number;
    change: (column: ColumnDetail) => ColumnDetail;
  }
): Promise<void> {
  const queryKey = databasesKeys.detail(params.databaseId).queryKey;
  await client.cancelQueries({ queryKey, exact: true });
  client.setQueryData(
    queryKey,
    (previous: DatabaseDetail | undefined) =>
      previous && {
        ...previous,
        tables: previous.tables.map((entry) =>
          entry.table.id === params.tableId &&
          entry.table.version <= params.tableVersion
            ? {
                ...entry,
                table: { ...entry.table, version: params.tableVersion },
                columns: entry.columns.map((column) =>
                  column.column.id === params.columnId
                    ? params.change(column)
                    : column
                ),
              }
            : entry
        ),
      }
  );
}

/** A result naming what happened to its resource: every kind but a reorder of the database's tables. */
type ChangedResult = Extract<OpResult, { change: unknown }>;

/** What a result of each op kind can say happened. */
type ResultChanges = {
  [Kind in ChangedResult['kind']]: Extract<
    ChangedResult,
    { kind: Kind }
  >['change']['kind'];
};

/** The result of a `Kind` op whose change answered `Change`. */
export type ResultOf<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
> = Extract<ChangedResult, { kind: Kind }> & {
  change: Extract<
    Extract<ChangedResult, { kind: Kind }>['change'],
    { kind: Change }
  >;
};

export function isResult<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
>(
  result: OpResult | undefined,
  kind: Kind,
  change: Change
): result is ResultOf<Kind, Change> {
  return (
    result?.kind === kind && 'change' in result && result.change.kind === change
  );
}

/**
 * Apply one op and pick its result. A refusal reads the detail again, so
 * whatever was patched in ahead of the answer gives way to what is stored.
 */
export function applyOp<
  Kind extends keyof ResultChanges,
  Change extends ResultChanges[Kind],
>(
  databaseId: string,
  op: DatabaseOp,
  expected: { kind: Kind; change: Change }
): ResultAsync<ResultOf<Kind, Change>, DatabaseOpFailure> {
  return applyDatabaseOps(databaseId, [op])
    .mapErr((error): DatabaseOpFailure => ({ kind: 'ops', error }))
    .andThen((results) => {
      const [result] = results;
      if (!isResult(result, expected.kind, expected.change))
        return errAsync<ResultOf<Kind, Change>, DatabaseOpFailure>({
          kind: 'unexpected-result',
        });
      return okAsync(result);
    });
}
