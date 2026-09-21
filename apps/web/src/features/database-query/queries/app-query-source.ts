import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { querySql } from '@queries/storage/databases';
import { databaseQueryKeys, databasesKeys } from '@queries/storage/keys';
import { useEntitySubscription } from '@service-connection/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { storageServiceClient } from '@service-storage/client';
import type { QueryCapabilities } from '../context/query-context';
import { createQuestionCapabilities } from './question-capabilities';

/** Production transport adapters; the composer only receives these narrow capabilities. */
export const queryCapabilities: QueryCapabilities = createQuestionCapabilities({
  generate: async (input) => {
    const { generateDatabaseQuery } = await import(
      '@service-cognition/database-query'
    );
    return generateDatabaseQuery(input);
  },
  read: (sql) =>
    queryClient.fetchQuery({
      queryKey: databaseQueryKeys.answer(sql).queryKey,
      queryFn: () => querySql(sql),
      staleTime: 0,
    }),
  describe: (databaseId) =>
    queryClient.fetchQuery({
      queryKey: databasesKeys.detail(databaseId).queryKey,
      queryFn: () =>
        throwOnErr(() =>
          storageServiceClient.databases.get({ id: databaseId })
        ),
      staleTime: 0,
    }),
});
export const readLiveQuery = querySql;

export function subscribeToQueryChanges(
  onChange: (tableId: string, version: number) => void
) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== 'database_table_changed') return;
    try {
      const data =
        typeof message.data === 'string'
          ? JSON.parse(message.data)
          : message.data;
      if (
        typeof data?.tableId === 'string' &&
        typeof data?.version === 'number'
      )
        onChange(data.tableId, data.version);
    } catch {
      /* Invalid events do not change query state. */
    }
  });
}

export function trackQueryDatabase(id: string, onRefresh: () => void) {
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: id }),
    onRefresh
  );
}
