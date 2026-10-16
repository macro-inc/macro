import { throwOnErr } from '@core/util/result';
import { refreshEmailThreadCache } from '@queries/email/cache-cleanup';
import { emailKeys } from '@queries/email/keys';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export function useThreadOperations(
  threadId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  let previous: { thread: string; pending: boolean } | undefined;
  const query = useQuery(() => ({
    queryKey: emailKeys.threadOperations(threadId()).queryKey,
    enabled: enabled(),
    retry: false,
    queryFn: async () => {
      const thread = threadId();
      const operations = await throwOnErr(() =>
        emailClient.threadOperations(thread)
      );
      const pending = operations.some(
        (operation) => operation.state === 'pending'
      );
      if (previous?.thread === thread && previous.pending && !pending)
        void refreshEmailThreadCache(thread).catch(() => {});
      previous = { thread, pending };
      return operations;
    },
    // Keep an open thread current after actions from another window or client.
    refetchInterval: 5000,
  }));
  return query;
}
