import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { QueryAccount } from '@queries/auth/account-scope';

export const importContactKeys = createQueryKeys('linear-import-contacts', {
  assignees: (
    owner: string,
    account: QueryAccount,
    hostId: string,
    epoch: number,
    revision: number,
    labels: readonly string[]
  ) => [
    owner,
    account.userId,
    account.session,
    hostId,
    epoch,
    revision,
    labels,
  ],
});
