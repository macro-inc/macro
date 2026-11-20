import { createQueryKeys } from '@lukemorales/query-key-factory';

/** Keyed by the viewer's account, sign-in session and team (`PasswordScope.key`). */
export const passwordKeys = createQueryKeys('passwords', {
  items: (scope: string) => [scope, 'items'],
  folders: (scope: string) => [scope, 'folders'],
  agentRequests: (scope: string, itemId: string) => [
    scope,
    'agent-requests',
    itemId,
  ],
});
