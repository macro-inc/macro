import type { QuerySchema } from '../core/query';
import type { DatabaseDetail, ExecOutcome } from '@service-storage/databases';
import { useQuery } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';

export function toQuerySchema(detail: DatabaseDetail): QuerySchema {
  return {
    databaseId: detail.database.id,
    name: detail.database.name,
    tables: detail.tables.map((table) => ({
      id: table.table.id, name: table.table.name, sqlName: table.sql_name,
      columns: table.columns.map((column) => ({
        name: column.definition.definition.display_name,
        sqlName: column.sql_name,
        type: column.definition.definition.data_type,
        multiple: column.definition.definition.is_multi_select,
        options: column.definition.property_options.map((option) => String(option.value.value)),
      })),
    })),
  };
}

export const databaseQueryKey = (sql: string) => ['database-query', sql] as const;

export function createLiveQuerySource(input: {
  sql: () => string;
  read: (sql: string) => Promise<ExecOutcome>;
  subscribe: (onChange: (tableId: string, version: number) => void) => void;
}) {
  const query = useQuery(() => ({
    queryKey: databaseQueryKey(input.sql()),
    queryFn: () => input.read(input.sql()),
    enabled: !!input.sql().trim(),
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: true,
  }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.subscribe((tableId, version) => {
    const result = query.isSuccess ? query.data : undefined;
    const readVersion = result?.read_versions[tableId];
    if (readVersion === undefined || version <= readVersion) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void query.refetch(); }, 300);
  });
  onCleanup(() => clearTimeout(timer));
  return query;
}
