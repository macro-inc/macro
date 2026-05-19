import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { emailKeys } from './keys';

const LABEL_STALE_TIME = 5 * 60 * 1000;

export function useEmailLabelsQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.labels.queryKey,
    queryFn: async () =>
      throwOnErr(async () => await emailClient.getUserLabels()),
    staleTime: LABEL_STALE_TIME,
    refetchOnWindowFocus: 'always',
  }));
}

export function invalidateEmailLabels() {
  queryClient.cancelQueries({ queryKey: emailKeys.labels.queryKey });
  queryClient.invalidateQueries({
    queryKey: emailKeys.labels.queryKey,
  });
}
