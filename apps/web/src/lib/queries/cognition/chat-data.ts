import { catchToResult, throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { chatDataQueryKey } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

function chatQueryOptions(chatId: string) {
  return {
    queryKey: chatDataQueryKey(chatId),
    queryFn: async () =>
      await throwOnErr(
        async () => await cognitionApiServiceClient.getChat({ chat_id: chatId })
      ),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  };
}

/**
 * Fetch a chat fresh from the service through the query cache, so mounted
 * chat queries reuse the response instead of refetching.
 */
export async function fetchAndCacheChat(chatId: string) {
  return await catchToResult(
    async () =>
      await queryClient.fetchQuery({
        ...chatQueryOptions(chatId),
        staleTime: 0,
      })
  );
}

export function useChatDataQuery(chatId: Accessor<string>) {
  return useQuery(() => ({
    ...chatQueryOptions(chatId()),
    select: (data) => data.chat,
    enabled: !!chatId(),
  }));
}
