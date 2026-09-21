import { throwOnErr } from '@core/util/result';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import type {
  DatabaseColumnDetail,
  DatabaseTableDetail,
  ExecOutcome,
  ExecRequest,
} from '@service-storage/databases';
import { useQueries } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { DatabaseRelationSource } from '../context/relation-source';
import type { DatabaseRelatedRow } from '../core/database-relations';
import { ROW_ID_COLUMN, selectAllStatement } from '../sql';

export function relatedRows(
  table: DatabaseTableDetail,
  data: ExecOutcome
): DatabaseRelatedRow[] {
  const result = data.results[0];
  if (!result) return [];
  const title =
    table.columns.find(
      (column) =>
        !column.column.config &&
        column.definition.definition.data_type === 'STRING' &&
        !column.definition.definition.is_multi_select
    ) ??
    table.columns.find(
      (column) =>
        !column.column.config && !column.definition.definition.is_multi_select
    );
  const rowIndex = result.columns.findIndex(
    (column) => column.name === ROW_ID_COLUMN
  );
  const titleIndex = result.columns.findIndex(
    (column) => column.name === title?.sql_name
  );
  return result.rows.flatMap((row) =>
    typeof row[rowIndex] === 'string'
      ? [
          {
            id: String(row[rowIndex]),
            name: String(row[titleIndex] ?? '').trim() || 'Unnamed',
          },
        ]
      : []
  );
}

/** One cached request per target database/table, shared by every visible relation cell. */
export function createDatabaseRelations(props: {
  columns: Accessor<DatabaseColumnDetail[]>;
  exec: (request: ExecRequest) => Promise<ExecOutcome>;
}) {
  const targets = createMemo(() => {
    const unique = new Map<string, { databaseId: string; tableId: string }>();
    for (const column of props.columns()) {
      const config = column.column.config;
      if (config?.kind === 'link')
        unique.set(config.table_id, {
          databaseId: config.database_id,
          tableId: config.table_id,
        });
    }
    return [...unique.values()];
  });
  const databases = createMemo(() => [
    ...new Set(targets().map((target) => target.databaseId)),
  ]);
  const details = useQueries(() => ({
    queries: databases().map((id) => ({
      queryKey: databasesKeys.detail(id).queryKey,
      queryFn: () =>
        throwOnErr(() => storageServiceClient.databases.get({ id })),
      staleTime: 30_000,
      throwOnError: false,
    })),
  }));
  const tables = createMemo(() =>
    targets().map((target) => {
      const query = details[databases().indexOf(target.databaseId)];
      return query && !query.isPending
        ? query.data?.tables.find((entry) => entry.table.id === target.tableId)
        : undefined;
    })
  );
  const queries = useQueries(() => ({
    queries: targets().map((target, index) => {
      const table = tables()[index];
      return {
        queryKey: databasesKeys.rows(target.databaseId, target.tableId)
          .queryKey,
        queryFn: () =>
          props.exec({
            sql: selectAllStatement(table!.read_sql_name ?? table!.sql_name),
          }),
        enabled: !!table,
        throwOnError: false,
      };
    }),
  }));
  const rows = createMemo(() =>
    targets().map((_, index) => {
      const query = queries[index];
      const table = tables()[index];
      return query && !query.isPending && query.data && table
        ? relatedRows(table, query.data)
        : [];
    })
  );
  return (tableId: string): DatabaseRelationSource => {
    const index = () =>
      targets().findIndex((target) => target.tableId === tableId);
    const detail = () =>
      details[databases().indexOf(targets()[index()]?.databaseId)];
    const table = () => tables()[index()];
    const query = () => queries[index()];
    return {
      name: () => table()?.table.name ?? 'Related records',
      rows: () => rows()[index()] ?? [],
      loading: () =>
        !!detail()?.isPending || (!!table() && !!query()?.isPending),
      error: () =>
        detail()?.isError || query()?.isError
          ? 'Related records could not be loaded.'
          : !detail()?.isPending && !table()
            ? 'This related table is unavailable.'
            : undefined,
      refresh: async () => {
        await detail()?.refetch({ throwOnError: true });
        await query()?.refetch({ throwOnError: true });
      },
    };
  };
}
