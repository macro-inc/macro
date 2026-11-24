import { createQueryKeys } from '@lukemorales/query-key-factory';

export const databaseViewKeys = createQueryKeys('database-views', {
  /** Where a board view's cards sit. */
  positions: (databaseId: string, viewId: string) => ({
    queryKey: [databaseId, viewId],
  }),
});

export const databaseColumnKeys = createQueryKeys('database-columns', {
  /** A column's type-change dry run, as of one table version. */
  casts: (
    databaseId: string,
    tableId: string,
    columnId: string,
    version: number
  ) => ({
    queryKey: [databaseId, tableId, columnId, version],
  }),
});

export const databaseWebhookKeys = createQueryKeys('database-webhooks', {
  /** A database's webhooks. */
  list: (databaseId: string) => ({ queryKey: [databaseId] }),
});

export const databaseRowSearchKeys = createQueryKeys('database-row-search', {
  /** Rows matching a typed term, every other kind of result left out. */
  term: (term: string, pageSize: number) => ({ queryKey: [term, pageSize] }),
});
