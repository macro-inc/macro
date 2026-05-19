import { throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { useQuery } from '@tanstack/solid-query';

const CHAT_STALE_TIME = 30 * 1000;

export function useChatQuery(chatId: () => string | undefined) {
  return useQuery(() => {
    const id = chatId();

    return {
      queryKey: ['chat', id],
      queryFn: async () =>
        throwOnErr(
          async () => await cognitionApiServiceClient.getChat({ chat_id: id! })
        ),
      staleTime: CHAT_STALE_TIME,
      enabled: !!id,
    };
  });
}
