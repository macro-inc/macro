import type { CrmContactEntity } from '@entity';
import { Telemetry } from '@macro-inc/observability';
import { queryReadyGate } from '@queries/gate';
import { soupKeys } from '@queries/soup/keys';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import { infiniteQueryOptions, useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { CrmRecordDependencies } from './dependencies';
import { toCrmContactEntity } from './graphql';

function crmContactsQueryOptions(
  searchTerm: string,
  limit: number,
  enabled: boolean
) {
  return infiniteQueryOptions({
    queryKey: [...soupKeys.crmPeople('all').queryKey, searchTerm, limit],
    enabled,
    staleTime: 60_000,
    initialPageParam: null as string | null,
    // Each page names the search it answers, so a consumer reading
    // pages during a key change cannot attribute them to the new search.
    queryFn: ({ pageParam, signal }) =>
      Telemetry.span('crm.contact_search', async (span) => {
        span.setAttr('contacts.source', 'server');
        span.setAttr('search.query_length', searchTerm.length);
        span.setAttr('search.continuation', pageParam !== null);
        span.setAttr('search.limit', limit);
        const page = await fetchCrmContacts({
          cursor: pageParam,
          search: searchTerm,
          limit,
          signal,
        });
        span.setAttr('search.result_count', page.contacts.length);
        span.setAttr('search.has_more', !!page.nextCursor);
        return { ...page, search: searchTerm };
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
}

/** Cursor-paged GraphQL source for contact suggestions. */
export function useCrmContactsQuery(
  deps: Pick<CrmRecordDependencies, 'client'>,
  enabled: Accessor<boolean>,
  search: Accessor<string> = () => '',
  limit = 100
) {
  return useInfiniteQuery(
    () => crmContactsQueryOptions(search().trim(), limit, enabled()),
    () => deps.client
  );
}

/** Seeds Quick Access with the most recent visible contacts across the viewer's teams. */
export function useQuickAccessCrmContactsQuery(
  deps: CrmRecordDependencies,
  enabled: Accessor<boolean>
) {
  const query = useCrmContactsQuery(deps, enabled, () => '', 500);
  const contacts = createMemo<CrmContactEntity[]>(() =>
    enabled() && queryReadyGate(query)
      ? query.data.pages.flatMap((page) =>
          page.contacts.map(toCrmContactEntity)
        )
      : []
  );
  return { query, contacts };
}
