import { externalChatApi } from '@app/features/external-chat/queries/production-api';
import { toast } from '@core/component/Toast/Toast';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useExternalChatsQuery } from '@queries/external-chats';
import { useExternalChatListsSync } from '@queries/external-chats/sync';
import { queryReadyGate } from '@queries/gate';
import { useImportWhatsappHistoryMutation } from '@queries/whatsapp-linked';
import { createMemo } from 'solid-js';
import { historyPromptText, waitingForPhone } from '../core/history-import';

/**
 * The bottom-right prompt to import earlier WhatsApp messages. Macro asks the
 * owner's phone only when they press Import: each request wakes WhatsApp on
 * the phone, and on iOS one it can't finish in the background shows a
 * "syncing stopped" notification. One prompt covers all the owner's chats
 * waiting for the phone. It leaves while they import and comes back if the
 * phone didn't answer. It is the only way to start an import, so a close
 * lasts for this session only.
 */
export function WhatsAppHistoryImportPrompt() {
  const userId = useUserId();
  const chats = useExternalChatsQuery(externalChatApi, () => userId() ?? '');
  const importHistory = useImportWhatsappHistoryMutation();
  // The import's progress arrives as chat changes.
  useExternalChatListsSync();
  const waiting = createMemo(() =>
    queryReadyGate(chats) ? waitingForPhone(chats.data, userId()) : []
  );

  useKeyedPersistentToasts({
    items: () => (waiting().length ? [waiting()] : []),
    key: (group) =>
      group
        .map((chat) => chat.id)
        .sort()
        .join(','),
    itemsLoaded: () => chats.isSuccess && userId() !== undefined,
    toast: (group) => ({
      title: 'Import WhatsApp history',
      content(): string {
        return historyPromptText(group);
      },
      actions: [
        {
          label: 'Import',
          onClick: () =>
            fireAndForget(
              importHistory.mutateAsync().catch(() => {
                toast.failure(
                  "Couldn't start importing your WhatsApp history. Try again."
                );
              }),
              'whatsapp-linked.import-history'
            ),
        },
      ],
    }),
  });

  return null;
}
