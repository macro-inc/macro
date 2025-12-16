import { throwOnErr } from '@core/util/maybeResult';
import { queryClient } from '@queries/client';
import { emailClient } from '@service-email/client';
import { useQuery } from '@tanstack/solid-query';
import { emailKeys } from './keys';

const LINK_STALE_TIME = 5 * 60 * 1000;

export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.links.queryKey,
    queryFn: async () => throwOnErr(async () => await emailClient.getLinks()),
    staleTime: LINK_STALE_TIME,
  }));
}

export function invalidateEmailLinks() {
  queryClient.invalidateQueries({
    queryKey: emailKeys.links.queryKey,
  });
  queryClient.cancelQueries({ queryKey: emailKeys.links.queryKey });
  queryClient.setQueriesData({ queryKey: emailKeys.links.queryKey }, () => ({
    links: [],
  }));
}
