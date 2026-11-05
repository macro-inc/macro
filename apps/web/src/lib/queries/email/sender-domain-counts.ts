import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { emailKeys } from './keys';

/** The provider search is live and slow-ish; one answer per session is enough. */
const SENDER_DOMAIN_COUNTS_STALE_TIME = 30 * 60 * 1000;

async function fetchSenderDomainCounts(
  domains: readonly string[]
): Promise<Record<string, number>> {
  const { counts } = await throwOnErr(() =>
    emailClient.countSenderDomains({ domains: [...domains] })
  );
  return Object.fromEntries(
    counts.map(({ domain, messageCount }) => [domain, messageCount])
  );
}

function senderDomainCountsQueryOptions(domains: readonly string[]) {
  return queryOptions({
    queryKey: emailKeys.senderDomainCounts(domains).queryKey,
    queryFn: () => fetchSenderDomainCounts(domains),
    staleTime: SENDER_DOMAIN_COUNTS_STALE_TIME,
    // The server already answers 0 for each domain it couldn't check.
    retry: false,
  });
}

/**
 * Recent message counts per sender domain across the viewer's own inboxes,
 * searched live at the mail provider, so they are known before the backfill.
 */
export function useSenderDomainCountsQuery(domains: readonly string[]) {
  return useQuery(() => senderDomainCountsQueryOptions(domains));
}
