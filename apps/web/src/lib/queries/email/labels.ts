import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { assertQueryAccount, type QueryAccount } from '../auth/account-scope';
import { useQueryAccount } from '../auth/use-query-account';
import { emailKeys } from './keys';

/** Labels change rarely; a few minutes is fresh enough to name one. */
const LABELS_STALE_TIME = 5 * 60 * 1000;

/** The mailbox labels of every inbox the person has connected. */
export function emailUserLabelsQueryOptions(
  account: QueryAccount | undefined,
  enabled: boolean
) {
  return {
    queryKey: emailKeys.userLabels(account?.userId).queryKey,
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      assertQueryAccount(account);
      signal.throwIfAborted();
      const labels = await throwOnErr(() => emailClient.getUserLabels());
      signal.throwIfAborted();
      assertQueryAccount(account);
      return labels;
    },
    enabled: !!account && enabled,
    staleTime: LABELS_STALE_TIME,
  };
}

export function useEmailUserLabelsQuery(enabled: Accessor<boolean>) {
  const account = useQueryAccount();
  return useQuery(() => emailUserLabelsQueryOptions(account(), enabled()));
}
