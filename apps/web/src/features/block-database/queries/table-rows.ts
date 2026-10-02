import { databaseSqlSchema } from '@core/database-sql/catalog';
import type { DatabaseOp } from '@core/database-sql/generated/types';
import { type ResultError, thrownResultErrorHasCode } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import {
  createDatabaseSqlQuery,
  type DatabaseSqlQuery,
  type DatabaseSqlQueryCapabilities,
  type DatabaseSqlRun,
  type DatabaseSqlStatement,
  readDatabaseSql,
  refreshInBackground,
  sameDatabaseSqlStatement,
} from '@queries/database-sql/create-database-sql-query';
import { databaseDetailQueryOptions } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type {
  DatabaseOpsError,
  DatabaseSchemaErrorCode,
} from '@service-storage/databases';
import type { ColumnDetail } from '@service-storage/generated/schemas/columnDetail';
import type { DatabaseDetail } from '@service-storage/generated/schemas/databaseDetail';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { OpResult } from '@service-storage/generated/schemas/opResult';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { useQueryClient } from '@tanstack/solid-query';
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow';
import { type Accessor, createMemo, createSignal, untrack } from 'solid-js';
import { match, P } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import type {
  DatabaseRowsSource,
  DatabaseWriteResult,
} from '../context/table-source';
import { missingOptionLabels, mutationOp } from '../core/cell-ops';
import {
  type DatabaseColumnType,
  inferDatabaseNumber,
} from '../core/column-inference';
import type {
  DatabaseCellValue,
  DatabaseViewColumn,
} from '../core/database-view';
import { gridRows } from '../core/grid-cells';
import type { DatabaseRow, DatabaseRowMutation } from '../core/table';
import type {
  DatabaseCellFailure,
  DatabaseReadFailure,
  DatabaseWriteFailure,
} from '../core/write-failure';
import { rowsByIdStatement } from '../sql';
import { patchTableColumn } from './detail-cache';
import {
  refreshChangedRows,
  type TableChangesCapabilities,
} from './table-changes';

export function toViewColumn(column: ColumnDetail): DatabaseViewColumn {
  const relation =
    column.column.config?.kind === 'link' ? column.column.config : undefined;
  return {
    id: column.column.id,
    name:
      column.column.display_name ?? column.definition.definition.display_name,
    dataType: column.definition.definition.data_type,
    isMultiSelect: !!relation || column.definition.definition.is_multi_select,
    options: column.definition.property_options.map((option) => ({
      id: option.id,
      label: String(option.value.value),
      color: option.color,
    })),
    writable: column.writable,
    sharedOutsideDatabase: column.shared_outside_database,
    ...(relation
      ? {
          relation: {
            databaseId: relation.database_id,
            tableId: relation.table_id,
          },
        }
      : {}),
    specificEntityType: column.definition.definition.specific_entity_type,
    inferType: column.column.infer_type,
  };
}

/** A stale table or column name, which a refreshed schema may resolve. */
function isStaleSchema(
  failure: DatabaseReadFailure | DatabaseWriteFailure
): boolean {
  return (
    failure.kind === 'engine' ||
    (failure.kind === 'ops' && failure.error.code === 'INVALID_OP')
  );
}

/** The service answered and refused: the write certainly did not land. */
function isDefiniteRefusal(error: DatabaseOpsError): boolean {
  return match(error.code)
    .with(
      P.union(
        'INVALID_OP',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
        'GONE'
      ),
      () => true
    )
    .otherwise(() => false);
}

const TABLE_UNAVAILABLE = { kind: 'table-unavailable' } as const;

/** A missing or deleted database means the table is gone; anything else is a failed read. */
function schemaReadFailure(thrown: unknown): DatabaseReadFailure {
  return thrownResultErrorHasCode(thrown, 'NOT_FOUND') ||
    thrownResultErrorHasCode(thrown, 'GONE')
    ? TABLE_UNAVAILABLE
    : { kind: 'fetch', message: 'The table’s schema could not be read.' };
}

function sameIds(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

export function createDatabaseRowsSource(props: {
  databaseId: string;
  table: Accessor<TableDetail>;
  /** The view whose rows the engine reads, filtered and sorted as it says. */
  view: Accessor<DatabaseView>;
  /** Applies a write's ops to this database; reads run in the browser's SQL engine. */
  applyOps: (ops: DatabaseOp[]) => ResultAsync<OpResult[], DatabaseOpsError>;
  /** Where the engine reads rows from; the app's GraphQL client by default. */
  read?: DatabaseSqlQueryCapabilities;
  /** Calls back with the version of each change the gateway reports for this table. */
  onTableChanged: (listener: (version: number) => void) => void;
  /** Calls back with the version each batch this viewer commits, such as an added or renamed column, moves this table to. */
  onCommitted: (listener: (version: number) => void) => void;
  /**
   * The journal and row cache an incremental refresh reads, given how to read rows by id.
   * Left out, a change reads the table whole.
   */
  changes?: (
    readRows: (rowIds: string[]) => ResultAsync<void, DatabaseReadFailure>
  ) => TableChangesCapabilities;
  applyVersions: (versions: Record<string, number>) => void;
  addOption: (
    columnId: string,
    label: string
  ) => ResultAsync<void, DatabaseOpsError>;
}): DatabaseRowsSource {
  const queryClient = useQueryClient();
  const tableId = props.table().table.id;
  const detailKey = databasesKeys.detail(props.databaseId).queryKey;
  let schemaStale = false;
  // Only advance across schema changes this writer has itself acknowledged.
  const inferredVersions = new Map<number, number>();
  // The newest version this viewer's own batches moved the table to. A new
  // column's type settles against it: its add and rename each moved the table.
  let committedVersion: number | undefined;
  props.onCommitted((version) => {
    committedVersion = Math.max(committedVersion ?? version, version);
  });
  const cachedDetail = () =>
    queryClient.getQueryData<DatabaseDetail>(detailKey);
  /**
   * The table as the cached schema has it; undefined once the schema no
   * longer lists it. Before the schema is cached the prop is all there is.
   */
  const currentTable = (): TableDetail | undefined => {
    const detail = cachedDetail();
    if (!detail) return props.table();
    return detail.tables.find((entry) => entry.table.id === tableId);
  };
  // Reads are rebuilt from the cached schema: a refreshed table name must
  // reach the retry even when the table prop has not caught up.
  const [schemaRefreshes, setSchemaRefreshes] = createSignal(0);

  function refreshSchema(): ResultAsync<void, DatabaseReadFailure> {
    const fetched = async () => {
      await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
      return queryClient.fetchQuery({
        ...databaseDetailQueryOptions(props.databaseId),
        staleTime: 0,
      });
    };
    return ResultAsync.fromPromise(fetched(), schemaReadFailure).andThen(
      (detail) => {
        if (!detail.tables.some((entry) => entry.table.id === tableId))
          return err(TABLE_UNAVAILABLE);
        schemaStale = false;
        setSchemaRefreshes((count) => count + 1);
        return ok(undefined);
      }
    );
  }
  // Version-only schema updates must not recreate columns and remount editors.
  const details = createMemo(() => props.table().columns);
  /** A read of this table alone, built from the cached schema. */
  const tableStatement = (
    read: (
      table: TableDetail
    ) => { sql: string } | { view: DatabaseView } | undefined
  ) =>
    createMemo(
      (): DatabaseSqlStatement | undefined => {
        props.table();
        schemaRefreshes();
        const detail = cachedDetail();
        const table = currentTable();
        if (!detail || !table) return undefined;
        const statement = read(table);
        if (statement === undefined) return undefined;
        return {
          schema: databaseSqlSchema([{ ...detail, tables: [table] }]),
          scope: props.databaseId,
          ...statement,
        };
      },
      undefined,
      { equals: sameDatabaseSqlStatement }
    );
  const viewStatement = tableStatement(() => ({ view: props.view() }));
  const rowsQuery = createDatabaseSqlQuery(viewStatement, props.read);
  // A type change gives a column a new definition. Until the read of it
  // lands, the column keeps the definition its shown cells were read with.
  const shownDetails = createMemo<ColumnDetail[]>((held) => {
    const answered = new Map(
      rowsQuery
        .catalog()
        ?.tables.flatMap((table) =>
          table.columns.map((column) => [column.placement, column.id] as const)
        )
    );
    return details().map((column) => {
      const read = answered.get(column.column.id);
      if (read === undefined || read === column.definition.definition.id)
        return column;
      return (
        held.find(
          (previous) =>
            previous.column.id === column.column.id &&
            previous.definition.definition.id === read
        ) ?? column
      );
    });
  }, []);
  const columns = createMemo(() => shownDetails().map(toViewColumn));
  const [retainedIds, setRetainedIds] = createSignal<
    Accessor<readonly string[]>
  >(() => []);
  const retainedRowIds = createMemo(
    () => [...new Set(retainedIds()())].sort(),
    [],
    { equals: sameIds }
  );
  const retainedStatement = tableStatement((table) =>
    retainedRowIds().length
      ? { sql: rowsByIdStatement(table.sql_name, retainedRowIds()) }
      : undefined
  );
  const retainedQuery = createDatabaseSqlQuery(retainedStatement, props.read);
  // The table's version when the last completed read began. Accepted draft
  // writes can outlive this owner, so it advances on any awaited refresh.
  const [readVersion, setReadVersion] = createSignal(
    untrack(() => (currentTable() ?? props.table()).table.version)
  );
  // The newest version this writer's row writes made; it reads them back itself.
  let writtenVersion = 0;

  function rowsOf(query: DatabaseSqlQuery): DatabaseRow[] | undefined {
    const outcome = query.outcome();
    const catalog = query.catalog();
    if (!outcome || !catalog) return undefined;
    return gridRows(outcome, catalog, shownDetails());
  }
  const retainedRows = () => {
    const ids = retainedRowIds();
    if (!ids.length) return [];
    return (rowsOf(retainedQuery) ?? []).filter((row) =>
      ids.includes(row.rowId)
    );
  };
  const snapshot = () => {
    const rows = rowsOf(rowsQuery);
    if (!rows) return undefined;
    return {
      version: readVersion(),
      rows,
      retained: retainedRows(),
    };
  };

  /**
   * Read from the network again; what comes back is at least `version`. A
   * read a later one replaced shows nothing, so it leaves the version alone.
   */
  function readAgain(version: number): ResultAsync<void, DatabaseReadFailure> {
    return ResultAsync.combine([
      rowsQuery.refresh(),
      retainedRowIds().length
        ? retainedQuery.refresh()
        : okAsync<DatabaseSqlRun>({ landed: true }),
    ]).map(([rows, retained]) => {
      if (rows.landed && retained.landed)
        setReadVersion((previous) => Math.max(previous, version));
    });
  }
  function refresh(): ResultAsync<void, DatabaseReadFailure> {
    const failed = rowsQuery.error();
    const schema =
      failed && isStaleSchema(failed) ? refreshSchema() : okAsync(undefined);
    return schema.andThen(() => {
      const table = currentTable();
      return table
        ? readAgain(table.table.version)
        : errAsync<void, DatabaseReadFailure>(TABLE_UNAVAILABLE);
    });
  }
  /** Read these rows again by id, through the engine, into the cache the view reads. */
  function readRows(rowIds: string[]): ResultAsync<void, DatabaseReadFailure> {
    const detail = cachedDetail();
    const table = currentTable();
    if (!detail || !table) return errAsync(TABLE_UNAVAILABLE);
    return readDatabaseSql(
      {
        schema: databaseSqlSchema([{ ...detail, tables: [table] }]),
        scope: props.databaseId,
        sql: rowsByIdStatement(table.sql_name, rowIds),
      },
      props.read
    ).map(() => undefined);
  }
  /** Answer the open reads from the cache rows were read into; at least `version` once they land. */
  function answerFromCache(
    version: number
  ): ResultAsync<void, DatabaseReadFailure> {
    return ResultAsync.combine([
      rowsQuery.answerFromCache(),
      retainedRowIds().length
        ? retainedQuery.answerFromCache()
        : okAsync<DatabaseSqlRun>({ landed: true }),
    ]).map(([rows, retained]) => {
      if (rows.landed && retained.landed)
        setReadVersion((previous) => Math.max(previous, version));
    });
  }
  const changes = props.changes?.(readRows);
  // Another viewer's edit. This writer's own edits read their version back.
  props.onTableChanged((version) => {
    if (version <= Math.max(readVersion(), writtenVersion)) return;
    const target = Math.max(version, currentTable()?.table.version ?? version);
    const fullRead = () => readAgain(target);
    refreshInBackground({
      // Rows read by id reach the view only through a local cache; without one, read whole.
      refresh: () =>
        changes && rowsQuery.cached()
          ? refreshChangedRows({
              from: readVersion(),
              version: target,
              changes,
              answerFromCache,
              fullRead,
            })
          : fullRead(),
    });
  });

  function columnForWrite(
    table: TableDetail,
    columnId: string
  ): Result<ColumnDetail, DatabaseCellFailure> {
    const column = table.columns.find(
      (column) => column.column.id === columnId
    );
    return column?.writable ? ok(column) : err({ kind: 'read-only-column' });
  }

  function optionLabelsOf(table: TableDetail, columnId: string): string[] {
    const column = table.columns.find(
      (column) => column.column.id === columnId
    );
    return (column?.definition.property_options ?? []).map((option) =>
      String(option.value.value)
    );
  }

  /** The base a new column's type is settled against, past the settlements this writer made from it. */
  function latestInferenceBase(
    inferenceBaseVersion: number | undefined
  ): number | undefined {
    let base =
      inferenceBaseVersion === undefined || committedVersion === undefined
        ? (inferenceBaseVersion ?? committedVersion)
        : Math.max(inferenceBaseVersion, committedVersion);
    while (base !== undefined && inferredVersions.has(base))
      base = inferredVersions.get(base);
    return base;
  }

  /** Ask the service to type a new column, against the table at `base`. */
  async function inferColumnType(
    columnId: string,
    type: DatabaseColumnType,
    base: number
  ): Promise<
    Result<
      { column: ColumnDetail; base: number },
      ResultError<DatabaseSchemaErrorCode>[]
    >
  > {
    return Telemetry.span('database.column.infer_type', async (span) => {
      span.setAttr('database.column_type', type.dataType);
      const inferred = await storageServiceClient.databases.inferColumnType({
        id: props.databaseId,
        tableId,
        columnId,
        request: {
          dataType: type.dataType,
          ...(type.dataType === 'ENTITY'
            ? { specificEntityType: type.entityType }
            : {}),
          baseVersion: base,
        },
      });
      if (inferred.isErr()) {
        span.setAttr('database.outcome', 'error');
        return err(inferred.error);
      }
      span.event('schema_committed');
      const settled = inferred.value;
      inferredVersions.set(base, settled.table_version);
      await patchTableColumn(queryClient, {
        databaseId: props.databaseId,
        tableId,
        columnId,
        tableVersion: settled.table_version,
        change: () => settled.column,
      });
      span.setAttr('database.outcome', 'success');
      return ok({ column: settled.column, base: settled.table_version });
    });
  }

  /**
   * Settle a new column's type from its first value. Another first entry
   * may have typed it meanwhile; then the value is written against that type.
   * A table that moved since `base` is typed again at the version read now.
   * A column still left untyped takes an inferred value as text, so the
   * entry is never dropped; only a type the viewer picked is refused.
   */
  async function settleColumnType(
    columnId: string,
    type: DatabaseColumnType,
    base: number,
    picked: boolean
  ): Promise<
    Result<{ column: ColumnDetail; base: number }, DatabaseWriteFailure>
  > {
    const inferred = await inferColumnType(columnId, type, base);
    if (inferred.isOk()) return ok(inferred.value);
    const competing = inferred.error.some((error) => error.code === 'CONFLICT');
    // A failed refresh leaves the cached schema to decide.
    await refreshSchema();
    const table = currentTable();
    if (!table) return err(TABLE_UNAVAILABLE);
    const refreshed = columnForWrite(table, columnId);
    if (refreshed.isErr()) return err(refreshed.error);
    const current = { column: refreshed.value, base: table.table.version };
    if (!refreshed.value.column.infer_type)
      return competing
        ? ok(current)
        : err({ kind: 'type-refused', errors: inferred.error });
    const retried =
      competing && table.table.version !== base
        ? await inferColumnType(columnId, type, table.table.version)
        : inferred;
    if (retried.isOk()) return ok(retried.value);
    return picked
      ? err({ kind: 'type-refused', errors: retried.error })
      : ok(current);
  }

  /** A first value as its column takes it: a number column's text read as a number. */
  function fittedValue(
    column: ColumnDetail,
    value: string | number,
    numeric: number | undefined,
    requested: DatabaseColumnType | undefined
  ): Result<DatabaseCellValue, DatabaseWriteFailure> {
    const definition = column.definition.definition;
    if (
      requested?.dataType === 'ENTITY' &&
      (definition.data_type !== 'ENTITY' ||
        definition.specific_entity_type !== requested.entityType)
    )
      return err({ kind: 'type-mismatch' });
    if (definition.data_type !== 'NUMBER') return ok(value);
    return numeric === undefined ? err({ kind: 'not-a-number' }) : ok(numeric);
  }

  /** Settle the type of new columns from their first value, then fit values to their columns. */
  async function prepareFirstValues(
    mutation: DatabaseRowMutation,
    inferenceBaseVersion: number | undefined
  ): Promise<Result<DatabaseRowMutation, DatabaseWriteFailure>> {
    if (mutation.kind === 'delete' || mutation.kind === 'clear')
      return ok(mutation);
    let base = latestInferenceBase(inferenceBaseVersion);
    const values =
      mutation.kind === 'cell'
        ? { [mutation.columnId]: mutation.value }
        : { ...mutation.values };
    for (const [columnId, value] of Object.entries(values)) {
      if (value === null || value === '') continue;
      const table = currentTable();
      if (!table) return err(TABLE_UNAVAILABLE);
      const found = columnForWrite(table, columnId);
      if (found.isErr()) return err(found.error);
      let column = found.value;
      if (column.column.config?.kind === 'link') continue;
      const requested = mutation.columnTypes?.[columnId];
      const numeric =
        typeof value === 'number' ? value : inferDatabaseNumber(value);
      if (column.column.infer_type) {
        if (base === undefined) return err({ kind: 'needs-refresh' });
        const settled = await settleColumnType(
          columnId,
          requested ?? {
            dataType: numeric === undefined ? 'STRING' : 'NUMBER',
          },
          base,
          requested !== undefined
        );
        if (settled.isErr()) return err(settled.error);
        column = settled.value.column;
        base = settled.value.base;
      }
      const fitted = fittedValue(column, value, numeric, requested);
      if (fitted.isErr()) return err(fitted.error);
      values[columnId] = fitted.value;
    }
    return ok(
      mutation.kind === 'cell'
        ? { ...mutation, value: values[mutation.columnId] }
        : { ...mutation, values }
    );
  }

  async function writeRows(
    mutation: DatabaseRowMutation,
    inferenceBaseVersion: number | undefined,
    createOptions: boolean
  ): Promise<Result<DatabaseWriteResult, DatabaseWriteFailure>> {
    const prepared = await Telemetry.span('database.rows.prepare', async () =>
      prepareFirstValues(mutation, inferenceBaseVersion)
    );
    if (prepared.isErr()) return err(prepared.error);
    // Read the refreshed cache directly; Solid props may notify after fetchQuery resolves.
    const table = currentTable();
    if (!table) return err(TABLE_UNAVAILABLE);
    const op = mutationOp(tableId, prepared.value, (columnId) =>
      columnForWrite(table, columnId)
    );
    if (op.isErr()) return err(op.error);
    // A label the column lacks becomes an option in the same batch, ahead of the write.
    const newOptions: DatabaseOp[] = createOptions
      ? missingOptionLabels(op.value, (columnId) =>
          optionLabelsOf(table, columnId)
        ).map(({ column, labels }) => ({
          kind: 'column',
          table: tableId,
          column,
          change: {
            kind: 'add_options',
            options: labels.map((label) => ({ id: uuidv7(), label })),
          },
        }))
      : [];
    const applied = await props.applyOps([...newOptions, op.value]);
    if (applied.isErr())
      return err(
        mutation.kind === 'create' && !isDefiniteRefusal(applied.error)
          ? { kind: 'outcome-unknown' }
          : { kind: 'ops', error: applied.error }
      );
    const written = applied.value.at(-1);
    if (written?.kind !== 'rows') return err({ kind: 'unexpected-result' });
    writtenVersion = Math.max(writtenVersion, written.tableVersion);
    props.applyVersions({ [tableId]: written.tableVersion });
    // New options live in the schema; read it again in the background
    // so they show as options without suspending the grid.
    if (createOptions)
      void queryClient.invalidateQueries({
        queryKey: detailKey,
        exact: true,
      });
    return ok({
      insertedRowIds: match(written.change)
        .with({ kind: 'inserted' }, ({ rows }) => rows)
        .with({ kind: 'updated' }, { kind: 'deleted' }, () => [])
        .exhaustive(),
      version: written.tableVersion,
    });
  }

  async function write(
    mutation: DatabaseRowMutation,
    inferenceBaseVersion: number | undefined,
    createOptions: boolean
  ): Promise<Result<DatabaseWriteResult, DatabaseWriteFailure>> {
    if (schemaStale) {
      const refreshed = await refreshSchema();
      if (refreshed.isErr())
        return err(
          refreshed.error.kind === 'table-unavailable'
            ? TABLE_UNAVAILABLE
            : { kind: 'schema-unreachable' }
        );
    }
    const written = await writeRows(
      mutation,
      inferenceBaseVersion,
      createOptions
    );
    if (written.isErr() && isStaleSchema(written.error)) {
      schemaStale = true;
      // The failed edit keeps its own error; the next write refreshes first.
      await refreshSchema();
    }
    return written;
  }

  return {
    columns,
    snapshot,
    read: () => {
      const outcome = rowsQuery.outcome();
      const catalog = rowsQuery.catalog();
      const statement = viewStatement();
      return outcome && catalog && statement?.view
        ? { outcome, catalog, view: statement.view }
        : undefined;
    },
    loading: () => !rowsQuery.outcome() && rowsQuery.error() === undefined,
    refreshing: rowsQuery.loading,
    error: rowsQuery.error,
    refresh,
    addOption: props.addOption,
    retain: (rowIds) => setRetainedIds(() => rowIds),
    write: (mutation, inferenceBaseVersion, createOptions) =>
      new ResultAsync(write(mutation, inferenceBaseVersion, createOptions)),
  };
}
