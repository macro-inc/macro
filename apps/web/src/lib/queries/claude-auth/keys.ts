import { createQueryKeys } from '@lukemorales/query-key-factory';
export const claudeAuthKeys = createQueryKeys('claude-auth', {
  status: (owner: string | undefined) => [owner],
});
