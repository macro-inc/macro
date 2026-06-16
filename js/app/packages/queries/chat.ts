import { throwOnErr } from '@core/util/result';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { useQuery } from '@tanstack/solid-query';
import { queryClient } from './client';
import { historyKeys } from './history/keys';
import { invalidatePreview } from './preview';
import { soupKeys } from './soup/keys';

const CHAT_STALE_TIME = 30 * 1000;
const CHAT_RENAMED_MESSAGE_TYPE = 'chat_renamed';

type ChatRenamedMessage = {
  type: typeof CHAT_RENAMED_MESSAGE_TYPE;
  chat_id: string;
  name: string;
};

/** The models the current user may use (free → Haiku; professional → all). */
export function useModelsQuery() {
  return useQuery(() => ({
    queryKey: ['chat', 'models'],
    queryFn: async () =>
      throwOnErr(async () => await cognitionApiServiceClient.getModels()),
    staleTime: CHAT_STALE_TIME,
  }));
}

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

export function useChatRenameWebsocketSync() {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== CHAT_RENAMED_MESSAGE_TYPE) return;

    let data: ChatRenamedMessage;
    try {
      data = JSON.parse(message.data);
    } catch {
      console.error('unparsable chat rename payload', message);
      return;
    }

    if (data.type !== CHAT_RENAMED_MESSAGE_TYPE || !data.chat_id) return;

    queryClient.invalidateQueries({ queryKey: ['chat', data.chat_id] });
    queryClient.invalidateQueries({ queryKey: ['entity'] });
    queryClient.invalidateQueries({ queryKey: historyKeys.list.queryKey });
    queryClient.invalidateQueries({ queryKey: soupKeys.items._def });
    queryClient.invalidateQueries({ queryKey: soupKeys.astItems._def });
    queryClient.invalidateQueries({ queryKey: soupKeys.search._def });
    invalidatePreview(data.chat_id);
  });
}
