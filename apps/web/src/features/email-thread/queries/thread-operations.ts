import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { refreshEmailThreadCache } from '@queries/email/cache-cleanup';
import { emailKeys } from '@queries/email/keys';
import { emailClient } from '@service-email/client';
import type { MailboxOperation } from '@service-email/generated/schemas';
import {
  type QueryFunctionContext,
  queryOptions,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

// Keep an open thread current after actions from another window or client.
// A deleted thread never comes back, so stop asking for it.
const operationsPollInterval = (query: { state: { error: unknown } }) =>
  thrownResultErrorHasCode(query.state.error, 'NOT_FOUND') ? false : 5000;

function hasPending(operations: readonly MailboxOperation[] | undefined) {
  return (
    operations?.some((operation) => operation.state === 'pending') ?? false
  );
}

// Cached callbacks outlive the thread view, so they close over the plain thread
// ID only; the previous result comes from the cache, not hook state.
function threadOperationsQueryOptions(threadId: string, enabled: boolean) {
  const { queryKey } = emailKeys.threadOperations(threadId);
  return queryOptions({
    queryKey,
    enabled,
    retry: false,
    queryFn: async ({ client }: QueryFunctionContext) => {
      const wasPending = hasPending(
        client.getQueryData<MailboxOperation[]>(queryKey)
      );
      const operations = await throwOnErr(() =>
        emailClient.threadOperations(threadId)
      );
      if (wasPending && !hasPending(operations))
        void refreshEmailThreadCache(threadId).catch(() => {});
      return operations;
    },
    refetchInterval: operationsPollInterval,
  });
}

export function useThreadOperations(
  threadId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => threadOperationsQueryOptions(threadId(), enabled()));
}
