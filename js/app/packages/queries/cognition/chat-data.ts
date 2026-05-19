import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatResponse } from '@service-cognition/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { chatDataQueryKey } from './keys';

const STALE_TIME = 60 * 1000;
const GC_TIME = 10 * 60 * 1000;

async function fetchChatData(chatId: string): Promise<ChatResponse> {
  const result = await cognitionApiServiceClient.getChat({ chat_id: chatId });
  if (result.isErr()) {
    throw new Error('Failed to fetch chat');
  }
  return result.value.chat;
}

export function useChatDataQuery(chatId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: chatDataQueryKey(chatId()),
    queryFn: () => fetchChatData(chatId()),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!chatId(),
  }));
}
