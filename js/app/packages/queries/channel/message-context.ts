import { throwOnErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { getMessageWithContextResponseError } from '@service-comms/generated/client';
import type { GetMessageWithContextResponse } from '@service-comms/generated/models';
import {
  type QueryClient,
  type UseBaseQueryOptions,
  useQuery,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelKeys } from './keys';

type MessageContextQueryOptions = UseBaseQueryOptions<
  GetMessageWithContextResponse,
  getMessageWithContextResponseError
>;

function messageContextQueryOptions(
  messageId: string,
  options?: { before?: number; after?: number }
): MessageContextQueryOptions {
  return {
    queryKey: channelKeys.messageContext(messageId).queryKey,
    queryFn: async () => {
      const result = await throwOnErr(
        async () =>
          await commsServiceClient.getMessageWithContext({
            message_id: messageId,
            before: options?.before ?? 0,
            after: options?.after ?? 0,
          })
      );

      return result;
    },
    staleTime: 5 * 60 * 1000,
  };
}

export function useMessageContextQuery(
  messageId: Accessor<string>,
  options?: Accessor<{
    before?: number;
    after?: number;
    queryOptions?: Omit<MessageContextQueryOptions, 'queryKey' | 'queryFn'>;
  }>,
  queryClient?: Accessor<QueryClient>
) {
  return useQuery(() => {
    const opts = options?.();
    return {
      initialData: undefined,
      ...opts?.queryOptions,
      ...messageContextQueryOptions(messageId(), {
        before: opts?.before,
        after: opts?.after,
      }),
    };
  }, queryClient);
}
