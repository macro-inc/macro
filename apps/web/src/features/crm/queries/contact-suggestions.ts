import type { CrmContactEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import { soupKeys } from '@queries/soup/keys';
import { fetchCrmContacts } from '@service-storage/crm-contacts';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { CrmRecordDependencies } from './dependencies';
import { toCrmContactEntity } from './graphql';

/** Cursor-paged GraphQL source shared by suggestions and the People directory. */
export function useCrmContactsQuery(
  deps: Pick<CrmRecordDependencies, 'client'>,
  enabled: Accessor<boolean>,
  search: Accessor<string> = () => '',
  limit = 100
) {
  return useInfiniteQuery(
    () => {
      const searchTerm = search().trim();
      return {
        queryKey: [...soupKeys.crmPeople('all').queryKey, searchTerm, limit],
        enabled: enabled(),
        staleTime: 60_000,
        initialPageParam: null as string | null,
        queryFn: ({ pageParam, signal }) =>
          fetchCrmContacts({
            cursor: pageParam,
            search: searchTerm,
            limit,
            signal,
          }),
        getNextPageParam: (page) => page.nextCursor,
      };
    },
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
    queryReadyGate(query)
      ? query.data.pages.flatMap((page) =>
          page.contacts.map(toCrmContactEntity)
        )
      : []
  );
  return { query, contacts };
}
