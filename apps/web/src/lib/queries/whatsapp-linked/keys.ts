import { createQueryKeys } from '@lukemorales/query-key-factory';

// Deliberately absent from persisted query scopes: pairing material lives only
// in memory while its dialog is open.
export const whatsappLinkedKeys = createQueryKeys('whatsapp-linked', {
  account: (userId: string) => [userId],
  pairing: (userId: string, pairingId: string) => [userId, pairingId],
  chats: (userId: string) => [userId],
});
