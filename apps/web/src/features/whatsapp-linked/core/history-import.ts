import type { ChatSummary } from '@app/features/external-chat/core/chat';

/**
 * The viewer's own WhatsApp chats whose earlier messages wait for their
 * phone, while their account is connected (only it can ask the phone).
 */
export function waitingForPhone(
  chats: readonly ChatSummary[],
  viewer: string | undefined
): ChatSummary[] {
  return chats.filter(
    (chat) =>
      chat.provider === 'whatsapp' &&
      chat.ownerId === viewer &&
      chat.backfill?.state === 'waiting_for_phone' &&
      chat.sendReason !== 'no_account' &&
      chat.sendReason !== 'disconnected'
  );
}

/** What the prompt asks, naming the chat when there is one. */
export function historyPromptText(chats: readonly ChatSummary[]): string {
  const what =
    chats.length === 1
      ? `the earlier messages of ${chats[0]?.name}`
      : `earlier messages of ${chats.length} chats`;
  return `Open WhatsApp on your phone and keep it open, then import ${what}.`;
}
