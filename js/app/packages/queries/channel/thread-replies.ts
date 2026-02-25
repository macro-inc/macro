import { throwOnErr } from '@core/util/maybeResult';
import { type ApiThreadReply, commsServiceClient } from '@service-comms/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { channelKeys } from './keys';

export function threadRepliesQueryOptions(
  channelId: string,
  messageId: string
) {
  return {
    queryKey: channelKeys.threadReplies(channelId, messageId).queryKey,
    queryFn: async (): Promise<Array<ApiThreadReply>> => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.getThreadReplies({
            channel_id: channelId,
            message_id: messageId,
          })
      );
    },
    staleTime: Infinity,
  };
}

export function useThreadRepliesQuery(
  channelId: Accessor<string>,
  messageId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => ({
    ...threadRepliesQueryOptions(channelId(), messageId()),
    enabled: enabled(),
  }));
}
