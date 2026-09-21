import { throwOnErr } from '@core/util/result';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type {
  DatabaseColumnDetail,
  DatabaseDetail,
  DatabaseTableDetail,
  ExecOutcome,
  ExecRequest,
} from '@service-storage/databases';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  type DatabaseRowsSource,
  DatabaseWriteConflict,
  DatabaseWriteOutcomeUnknown,
} from '../context/table-source';
import {
  type DatabaseColumnType,
  inferDatabaseNumber,
} from '../core/column-inference';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRowMutation } from '../core/table';
import {
  deleteRowStatement,
  insertRowStatement,
  ROW_ID_COLUMN,
  selectAllStatement,
  updateCellStatement,
} from '../sql';

export function toViewColumn(column: DatabaseColumnDetail): DatabaseViewColumn {
  return {
    id: column.column.id,
    name:
      column.column.display_name ?? column.definition.definition.display_name,
    dataType: column.definition.definition.data_type,
    isMultiSelect: column.definition.definition.is_multi_select,
    options: column.definition.property_options.map((option) =>
      String(option.value.value)
    ),
    writable: column.writable,
    specificEntityType: column.definition.definition.specific_entity_type,
    inferType: column.column.infer_type ?? false,
  };
}

export function createDatabaseRowsSource(props: {
  databaseId: string;
  table: Accessor<DatabaseTableDetail>;
  exec: (request: ExecRequest) => Promise<ExecOutcome>;
  applyVersions: (versions: Record<string, number>) => void;
  addOption: (columnId: string, label: string) => Promise<void>;
}): DatabaseRowsSource {
  const queryClient = useQueryClient();
  const tableId = props.table().table.id;
  const detailKey = databasesKeys.detail(props.databaseId).queryKey;
  let staleSchemaError: Error | undefined;
  // Only advance across schema changes this writer has itself acknowledged.
  const inferredVersions = new Map<number, number>();
  const currentTable = () =>
    queryClient
      .getQueryData<DatabaseDetail>(detailKey)
      ?.tables.find((entry) => entry.table.id === tableId) ?? props.table();

  async function refreshSchema() {
    await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
    const detail = await queryClient.fetchQuery({
      queryKey: detailKey,
      queryFn: () =>
        throwOnErr(() =>
          storageServiceClient.databases.get({ id: props.databaseId })
        ),
      staleTime: 0,
      retry: false,
    });
    if (!detail.tables.some((entry) => entry.table.id === tableId))
      throw new Error('This table is no longer available.');
    staleSchemaError = undefined;
  }
  function isSqlError(error: unknown): error is Error {
    return (
      error instanceof Error && 'code' in error && error.code === 'SQL_ERROR'
    );
  }
  // Version-only schema updates must not recreate columns and remount editors.
  const details = createMemo(() => props.table().columns);
  const columns = createMemo(() =>
    details()
      .filter((column) => column.column.config?.kind !== 'lookup')
      .map(toViewColumn)
  );
  const query = useQuery(() => ({
    queryKey: databasesKeys.rows(props.databaseId, props.table().table.id)
      .queryKey,
    queryFn: () =>
      props.exec({
        sql: selectAllStatement(
          currentTable().read_sql_name ?? currentTable().sql_name
        ),
      }),
  }));
  // Accepted draft writes can outlive the query observer's owner. Retain actual
  // reads so a post-unmount option change supplies its version to the next write.
  const [refreshedOutcome, setRefreshedOutcome] = createSignal<ExecOutcome>();
  function newerRead(
    current: ExecOutcome | undefined,
    candidate: ExecOutcome | undefined
  ) {
    if (!current) return candidate;
    if (!candidate) return current;
    return (candidate.read_versions[tableId] ?? -1) >
      (current.read_versions[tableId] ?? -1)
      ? candidate
      : current;
  }
  // Status reads are safe outside Suspense. data is read only after initial load.
  const outcome = () =>
    newerRead(!query.isPending ? query.data : undefined, refreshedOutcome());
  const snapshot = () => {
    const data = outcome();
    if (!data) return undefined;
    const result = data.results[0];
    const rowIdIndex =
      result?.columns.findIndex((column) => column.name === ROW_ID_COLUMN) ??
      -1;
    const indexes = props.table().columns.map((column) => ({
      id: column.column.id,
      index:
        result?.columns.findIndex((entry) => entry.name === column.sql_name) ??
        -1,
    }));
    return {
      version: data.read_versions[props.table().table.id],
      rows: (result?.rows ?? []).flatMap((row) => {
        const rowId = row[rowIdIndex];
        return typeof rowId === 'string'
          ? [
              {
                rowId,
                cells: Object.fromEntries(
                  indexes.map(({ id, index }) => [id, row[index] ?? null])
                ),
              },
            ]
          : [];
      }),
    };
  };

  function columnForWrite(table: DatabaseTableDetail, columnId: string) {
    const column = table.columns.find(
      (column) => column.column.id === columnId
    );
    if (!column?.writable) throw new Error('This property is read-only.');
    return column;
  }

  function statement(mutation: DatabaseRowMutation) {
    // Read the refreshed cache directly; Solid props may notify after fetchQuery resolves.
    const table = currentTable();
    const tableSqlName = table.sql_name;
    if (mutation.kind === 'cell') {
      return updateCellStatement({
        tableSqlName,
        rowId: mutation.rowId,
        columnSqlName: columnForWrite(table, mutation.columnId).sql_name,
        value: mutation.value,
      });
    }
    if (mutation.kind === 'delete')
      return deleteRowStatement({ tableSqlName, rowId: mutation.rowId });
    return insertRowStatement({
      tableSqlName,
      values: Object.fromEntries(
        Object.entries(mutation.values).map(([id, value]) => [
          columnForWrite(table, id).sql_name,
          value,
        ])
      ),
    });
  }

  async function prepareFirstValues(
    mutation: DatabaseRowMutation,
    baseVersion: number | undefined
  ) {
    let version = baseVersion;
    while (version !== undefined && inferredVersions.has(version))
      version = inferredVersions.get(version);
    if (mutation.kind === 'delete') return { mutation, version };
    const values =
      mutation.kind === 'cell'
        ? { [mutation.columnId]: mutation.value }
        : { ...mutation.values };
    for (const [columnId, value] of Object.entries(values)) {
      if (value === null || value === '') continue;
      let column = columnForWrite(currentTable(), columnId);
      const requested = mutation.columnTypes?.[columnId];
      if (column.column.infer_type) {
        if (version === undefined)
          throw new Error(
            'Refresh this table before entering its first value.'
          );
        const numeric =
          typeof value === 'number' ? value : inferDatabaseNumber(value);
        const type: DatabaseColumnType = requested ?? {
          dataType: numeric === undefined ? 'STRING' : 'NUMBER',
        };
        const result = await storageServiceClient.databases.inferColumnType({
          id: props.databaseId,
          tableId,
          columnId,
          request: {
            data_type: type.dataType,
            ...(type.dataType === 'ENTITY'
              ? { specific_entity_type: type.entityType }
              : {}),
            base_version: version,
          },
        });
        if (result.isErr()) {
          const conflict = result.error.some(
            (error) => error.code === 'VERSION_CONFLICT'
          );
          try {
            await refreshSchema();
          } catch {
            // Preserve the rejected entry and its actual conflict/validation error.
          }
          const message =
            result.error[0]?.message ??
            'Could not set the column type. Your entry is kept.';
          if (conflict) throw new DatabaseWriteConflict(message);
          throw new Error(message);
        }
        column = result.value.column;
        inferredVersions.set(version, result.value.table_version);
        version = result.value.table_version;
        await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
        queryClient.setQueryData(
          detailKey,
          (previous: DatabaseDetail | undefined) =>
            previous && {
              ...previous,
              tables: previous.tables.map((entry) =>
                entry.table.id === tableId &&
                entry.table.version <= result.value.table_version
                  ? {
                      ...entry,
                      table: {
                        ...entry.table,
                        version: result.value.table_version,
                      },
                      columns: entry.columns.map((existing) =>
                        existing.column.id === columnId
                          ? result.value.column
                          : existing
                      ),
                    }
                  : entry
              ),
            }
        );
      }
      const definition = column.definition.definition;
      if (
        requested?.dataType === 'ENTITY' &&
        (definition.data_type !== 'ENTITY' ||
          definition.specific_entity_type !== requested.entityType)
      )
        throw new Error(
          'This column has a different type. Choose a matching mention or add a new column.'
        );
      if (definition.data_type === 'NUMBER' && typeof value === 'string') {
        const numeric = inferDatabaseNumber(value);
        if (numeric === undefined)
          throw new Error(
            'This column expects a number. Your entry is kept so you can correct it.'
          );
        values[columnId] = numeric;
      }
    }
    return {
      mutation:
        mutation.kind === 'cell'
          ? { ...mutation, value: values[mutation.columnId] }
          : { ...mutation, values },
      version,
    };
  }

  return {
    columns,
    snapshot,
    loading: () => query.isPending,
    refreshing: () => query.isFetching,
    error: () => (query.isError ? query.error : undefined),
    refresh: async () => {
      if (query.isError && isSqlError(query.error)) {
        staleSchemaError = query.error;
        await refreshSchema();
      }
      const result = await query.refetch({ throwOnError: true });
      setRefreshedOutcome((previous) => newerRead(previous, result.data));
    },
    addOption: props.addOption,
    write: async (mutation, version) => {
      const previousSchemaError = staleSchemaError;
      if (previousSchemaError) {
        try {
          await refreshSchema();
        } catch {
          throw previousSchemaError;
        }
      }
      try {
        const prepared = await prepareFirstValues(mutation, version);
        const request = {
          sql: statement(prepared.mutation),
          baseVersions:
            prepared.version === undefined
              ? undefined
              : { [tableId]: prepared.version },
        };
        let written: ExecOutcome;
        try {
          written = await props.exec(request);
        } catch (error) {
          const code =
            error instanceof Error && 'code' in error ? error.code : undefined;
          if (
            mutation.kind === 'create' &&
            ![
              'SQL_ERROR',
              'READ_ONLY',
              'VERSION_CONFLICT',
              'BUDGET_EXCEEDED',
              'UNAUTHORIZED',
              'FORBIDDEN',
              'NOT_FOUND',
              'GONE',
              'CONFLICT',
            ].includes(String(code))
          )
            throw new DatabaseWriteOutcomeUnknown(
              'This row may already be saved. Check the latest rows before creating it again. Your draft is kept here.'
            );
          throw error;
        }
        props.applyVersions(written.new_versions);
        return {
          insertedRowIds: written.inserted_row_ids,
          version: written.new_versions[tableId],
        };
      } catch (error) {
        if (isSqlError(error)) {
          staleSchemaError = error;
          try {
            await refreshSchema();
          } catch {
            // Keep the original failed edit; the next write must refresh first.
          }
        }
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'VERSION_CONFLICT'
        )
          throw new DatabaseWriteConflict(error.message);
        throw error;
      }
    },
  };
}
