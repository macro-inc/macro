/** Gateway liveness for external chats, apart from `./index` to keep the websocket out of startup. */

import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { createConnectionWebsocketEffect } from '@service-connection/websocket';
import { debounce } from '@solid-primitives/scheduled';
import type { Accessor } from 'solid-js';
import { z } from 'zod';
import { queryClient } from '../client';
import { parseMessageData } from '../storage/databases-sync';
import { whatsappLinkedKeys } from '../whatsapp-linked/keys';
import { externalChatsKeys } from './keys';

/** DSS pings this with no data; readers re-fetch. */
const EXTERNAL_CHAT_CHANGED_MESSAGE_TYPE = 'external_chat_changed';
const externalChatChangedSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('chats') }),
  z.object({ scope: z.literal('chat'), chatId: z.string() }),
]);
type ExternalChatChange = z.infer<typeof externalChatChangedSchema>;

/**
 * Opening a page asks DSS for a provider refresh that can finish before this
 * subscription exists; without a push by then, re-fetch once.
 */
const FALLBACK_REFETCH_MS = 3000;

function onExternalChatChanged(handle: (change: ExternalChatChange) => void) {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== EXTERNAL_CHAT_CHANGED_MESSAGE_TYPE) return;
    const change = parseMessageData(message, externalChatChangedSchema);
    if (change) handle(change);
  });
}

/** Schedules one re-fetch, cleared by the first push or by unmount. */
function fallbackRefetch(refetch: () => void) {
  const scheduled = debounce(refetch, FALLBACK_REFETCH_MS);
  scheduled();
  return scheduled.clear;
}

const refreshChatLists = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: whatsappLinkedKeys.chats._def }),
    queryClient.invalidateQueries({ queryKey: externalChatsKeys.list._def }),
  ]);

/**
 * While External is open: the owner's WhatsApp chat list (`chats`) and every
 * readable chat's summary (`chat`, for unread counts and names).
 */
export function useExternalChatListsSync() {
  const cancel = fallbackRefetch(() =>
    fireAndForget(
      Telemetry.span('external_chat.list.fallback_refetch', refreshChatLists),
      'external-chat-sync'
    )
  );
  onExternalChatChanged((change) => {
    cancel();
    if (change.scope === 'chats') {
      queryClient.invalidateQueries({
        queryKey: whatsappLinkedKeys.chats._def,
      });
    }
    queryClient.invalidateQueries({ queryKey: externalChatsKeys.list._def });
  });
}

function refreshChat(userId: string, chatId: string) {
  return Promise.all(
    [
      externalChatsKeys.detail(userId, chatId).queryKey,
      externalChatsKeys.messages(userId, chatId).queryKey,
      externalChatsKeys.delivery(userId, chatId).queryKey,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
  );
}

/** While one chat is open: its members, timeline and send outcomes. */
export function useExternalChatSync(
  userId: Accessor<string>,
  chatId: Accessor<string>
) {
  const cancel = fallbackRefetch(() =>
    fireAndForget(
      Telemetry.span('external_chat.fallback_refetch', (span) => {
        span.setAttr('external_chat.id', chatId());
        return refreshChat(userId(), chatId());
      }),
      'external-chat-sync'
    )
  );
  onExternalChatChanged((change) => {
    if (change.scope !== 'chat' || change.chatId !== chatId()) return;
    cancel();
    fireAndForget(refreshChat(userId(), chatId()), 'external-chat-sync');
  });
}
