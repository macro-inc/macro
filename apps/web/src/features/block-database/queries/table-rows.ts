import { databasesKeys } from '@queries/storage/keys';
import type { DatabaseColumnDetail, DatabaseTableDetail, ExecOutcome, ExecRequest } from '@service-storage/databases';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { DatabaseWriteConflict, type DatabaseRowsSource } from '../context/table-source';
import type { DatabaseViewColumn } from '../core/database-view';
import type { DatabaseRowMutation } from '../core/table';
import { deleteRowStatement, insertRowStatement, ROW_ID_COLUMN, selectAllStatement, updateCellStatement } from '../sql';

export function toViewColumn(column: DatabaseColumnDetail): DatabaseViewColumn {
  return {
    id: column.column.id,
    name: column.definition.definition.display_name,
    dataType: column.definition.definition.data_type,
    isMultiSelect: column.definition.definition.is_multi_select,
    options: column.definition.property_options.map((option) => String(option.value.value)),
    writable: column.writable,
  };
}

export function createDatabaseRowsSource(props: {
  databaseId: string;
  table: Accessor<DatabaseTableDetail>;
  exec: (request: ExecRequest) => Promise<ExecOutcome>;
  applyVersions: (versions: Record<string, number>) => void;
  addOption: (columnId: string, label: string) => Promise<void>;
}): DatabaseRowsSource {
  const query = useQuery(() => ({
    queryKey: databasesKeys.rows(props.databaseId, props.table().table.id).queryKey,
    queryFn: () => props.exec({ sql: selectAllStatement(props.table().sql_name) }),
  }));
  // Status reads are safe outside Suspense. data is read only after initial load.
  const outcome = () => !query.isPending ? query.data : undefined;
  const snapshot = () => {
    const data = outcome();
    if (!data) return undefined;
    const result = data.results[0];
    const rowIdIndex = result?.columns.findIndex((column) => column.name === ROW_ID_COLUMN) ?? -1;
    const indexes = props.table().columns.map((column) => ({ id: column.column.id, index: result?.columns.findIndex((entry) => entry.name === column.sql_name) ?? -1 }));
    return {
      version: data.read_versions[props.table().table.id],
      rows: (result?.rows ?? []).flatMap((row) => {
        const rowId = row[rowIdIndex];
        return typeof rowId === 'string' ? [{ rowId, cells: Object.fromEntries(indexes.map(({ id, index }) => [id, row[index] ?? null])) }] : [];
      }),
    };
  };

  function columnForWrite(columnId: string) {
    const column = props.table().columns.find((column) => column.column.id === columnId);
    if (!column?.writable) throw new Error('This property is read-only.');
    return column;
  }

  function statement(mutation: DatabaseRowMutation) {
    const tableSqlName = props.table().sql_name;
    if (mutation.kind === 'cell') {
      return updateCellStatement({ tableSqlName, rowId: mutation.rowId, columnSqlName: columnForWrite(mutation.columnId).sql_name, value: mutation.value });
    }
    if (mutation.kind === 'delete') return deleteRowStatement({ tableSqlName, rowId: mutation.rowId });
    return insertRowStatement({ tableSqlName, values: Object.fromEntries(Object.entries(mutation.values).map(([id, value]) => [columnForWrite(id).sql_name, value])) });
  }

  return {
    columns: () => props.table().columns.filter((column) => column.column.config?.kind !== 'lookup').map(toViewColumn),
    snapshot,
    loading: () => query.isPending,
    refreshing: () => query.isFetching,
    error: () => query.isError ? query.error : undefined,
    refresh: async () => { await query.refetch({ throwOnError: true }); },
    addOption: props.addOption,
    write: async (mutation, version) => {
      const tableId = props.table().table.id;
      try {
        const written = await props.exec({ sql: statement(mutation), baseVersions: version === undefined ? undefined : { [tableId]: version } });
        props.applyVersions(written.new_versions);
        return { insertedRowIds: written.inserted_row_ids, version: written.new_versions[tableId] };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'VERSION_CONFLICT') throw new DatabaseWriteConflict(error.message);
        throw error;
      }
    },
  };
}
