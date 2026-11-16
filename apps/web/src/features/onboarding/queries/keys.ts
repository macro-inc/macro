import { createQueryKeys } from '@lukemorales/query-key-factory';
import type { QueryAccount } from '@queries/auth/account-scope';

export const onboardingRoutineKeys = createQueryKeys('onboardingRoutines', {
  suggestions: null,
});

export const onboardingContactKeys = createQueryKeys('onboarding-contacts', {
  teammates: (
    owner: string,
    account: QueryAccount | undefined,
    hostId: string,
    epoch: number,
    domain: string | undefined,
    ownEmail: string | undefined
  ) => [
    owner,
    account?.userId ?? '',
    account?.session ?? -1,
    hostId,
    epoch,
    domain ?? '',
    ownEmail ?? '',
  ],
});
