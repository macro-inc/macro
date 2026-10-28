// Call chat shares the canonical message thread cache with every messaging surface.
import { createQueryKeys } from '@lukemorales/query-key-factory';

export { messageKeys as callChatKeys } from '@queries/messages/keys';

const guestCallChatKeys = createQueryKeys('guest-call-chat', {
  messages: (callId: string, participantId: string) => [callId, participantId],
});

export const guestCallChatKey = (callId: string, participantId: string) =>
  guestCallChatKeys.messages(callId, participantId).queryKey;
