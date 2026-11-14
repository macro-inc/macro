import { createQueryKeys } from '@lukemorales/query-key-factory';

// Deliberately absent from persisted query scopes: sign-in steps carry email
// addresses and codes and live only in memory while the dialog is open.
export const slackLinkedKeys = createQueryKeys('slack-linked', {
  accounts: (userId: string) => [userId],
  login: (userId: string, loginId: string) => [userId, loginId],
  conversations: (userId: string) => [userId],
});
