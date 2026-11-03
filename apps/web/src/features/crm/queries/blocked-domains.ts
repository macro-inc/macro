/**
 * The domains a team keeps out of email sync, served by
 * GET/PUT/DELETE `/crm/blocked-domains` (document storage service). Any
 * team member can read; blocking and unblocking are admin/owner-gated
 * server-side. Blocking also hides the company and contacts the CRM holds
 * for the domain, so changes refresh soup listings and record caches.
 */

import { throwOnErr } from '@core/util/result';
import { soupKeys } from '@queries/soup/keys';
import { invalidateCachedCrmContacts } from '@service-storage/crm-contacts';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { BlockedDomainsSource } from '../context/crm-sources';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

function blockedDomainsQueryOptions(deps: CrmQueryDependencies) {
  return queryOptions({
    queryKey: crmKeys.blockedDomains.queryKey,
    queryFn: async () =>
      await throwOnErr(() => deps.storage.listCrmBlockedDomains()),
  });
}

function setDomainBlockedOptions(deps: CrmQueryDependencies) {
  return {
    mutationFn: async ({
      domain,
      blocked,
    }: {
      domain: string;
      blocked: boolean;
    }) => {
      await throwOnErr(() =>
        blocked
          ? deps.storage.blockCrmDomain({ domain })
          : deps.storage.unblockCrmDomain({ domain })
      );
    },
    onSuccess: () => invalidateCachedCrmContacts(),
    // Covers the blocklist itself and the records it hid or showed.
    onSettled: () =>
      Promise.all([
        deps.client.invalidateQueries({ queryKey: crmKeys._def }),
        deps.client.invalidateQueries({ queryKey: soupKeys._def }),
      ]),
  };
}

export function useBlockedDomains(
  deps: CrmQueryDependencies
): BlockedDomainsSource {
  const query = useQuery(
    () => blockedDomainsQueryOptions(deps),
    () => deps.client
  );
  const mutation = useMutation(
    () => setDomainBlockedOptions(deps),
    () => deps.client
  );
  return {
    domains: () =>
      query.isSuccess ? query.data.map((entry) => entry.domain) : [],
    isPending: () => query.isPending,
    isError: () => query.isError && query.data === undefined,
    setBlocked: mutation,
  };
}
