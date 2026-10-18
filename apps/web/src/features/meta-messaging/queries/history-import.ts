import { throwOnErr } from '@core/util/result';
import { metaMessagingKeys } from '@queries/meta-messaging/keys';
import type { MetaHistoryImportView } from '@service-storage/generated/schemas/metaHistoryImportView';
import { metaMessagingClient } from '@service-storage/meta-messaging';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { historyActive } from '../core/history';

export function useHistoryImport(
  id: Accessor<string>,
  generation: Accessor<string>,
  connected: Accessor<boolean>
) {
  const client = useQueryClient();
  const key = () => metaMessagingKeys.history(id(), generation()).queryKey;
  const query = useQuery(() =>
    historyQueryOptions(id(), generation(), connected())
  );
  const start = useMutation(() => ({
    mutationFn: () => throwOnErr(() => metaMessagingClient.importHistory(id())),
    onSuccess: (view: MetaHistoryImportView) =>
      client.setQueryData(key(), view),
  }));
  return { query, start };
}

function historyQueryOptions(
  id: string,
  generation: string,
  connected: boolean
) {
  return queryOptions({
    queryKey: metaMessagingKeys.history(id, generation).queryKey,
    queryFn: () => throwOnErr(() => metaMessagingClient.history(id)),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    refetchInterval: (q) =>
      connected &&
      q.state.status !== 'error' &&
      historyActive(q.state.data?.import)
        ? 3_000
        : false,
  });
}
