import { databaseQueryKeys } from '@queries/storage/keys';
import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { useQuery } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import type { QuerySchema } from '../core/query';

export function toQuerySchema(
  detail: DatabaseDetail,
  activeTableId?: string
): QuerySchema {
  const platformTables: QuerySchema['tables'] = [
    {
      id: 'platform:people',
      name: 'People in your teams',
      sqlName: 'people',
      primaryKey: 'id',
      columns: ['name', 'email'].map((name) => ({
        name,
        sqlName: name,
        type: 'String',
        multiple: false,
        options: [],
      })),
    },
    {
      id: 'platform:documents',
      name: 'Documents you can access',
      sqlName: 'documents',
      primaryKey: 'id',
      columns: ['title', 'owner_id', 'created_at', 'updated_at'].map(
        (name) => ({
          name,
          sqlName: name,
          type: 'String',
          multiple: false,
          options: [],
        })
      ),
    },
  ];
  return {
    databaseId: detail.database.id,
    name: detail.database.name,
    focusTableId: detail.tables.find(({ table }) => table.id === activeTableId)
      ?.table.id,
    tables: [
      ...detail.tables.map((table) => ({
        id: table.table.id,
        name: table.table.name,
        sqlName: table.read_sql_name ?? table.sql_name,
        primaryKey: 'row_id',
        columns: table.columns.map((column) => ({
          name:
            column.column.display_name ??
            column.definition.definition.display_name,
          sqlName: column.sql_name,
          type: column.definition.definition.data_type,
          multiple: column.definition.definition.is_multi_select,
          options: column.definition.property_options.map((option) =>
            String(option.value.value)
          ),
        })),
      })),
      ...platformTables,
    ],
  };
}

export function createLiveQuerySource(input: {
  sql: () => string;
  read: (sql: string) => Promise<ExecOutcome>;
  subscribe: (onChange: (tableId: string, version: number) => void) => void;
}) {
  const query = useQuery(() => {
    const statement = input.sql();
    return {
      queryKey: databaseQueryKeys.answer(statement).queryKey,
      queryFn: () => input.read(statement),
      enabled: !!statement.trim(),
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: true,
    };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.subscribe((tableId, version) => {
    // A failed refresh hides the answer, but its last successful dependency
    // versions still let later table events recover the query automatically.
    const result = !query.isPending ? query.data : undefined;
    const readVersion = result?.read_versions[tableId];
    if (readVersion === undefined || version <= readVersion) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      void query.refetch();
    }, 300);
  });
  onCleanup(() => clearTimeout(timer));
  return query;
}
