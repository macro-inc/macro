import { QUERY_FILTERS_BASE } from '@app/features/next-soup/filters/query-filters';
import { throwOnErr } from '@core/util/result';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { type Accessor, createEffect } from 'solid-js';
import { soupKeys } from '../../../lib/queries/soup/keys';
import type { CrmPerson } from '../core/people';
import type { CrmQueryDependencies } from './dependencies';
import { crmKeys } from './keys';

/** Assemble one people directory from the existing company/contact endpoints.
 * Pages appear progressively; at most four company requests run at once.
 */
export function useCrmPeopleQuery(
  deps: CrmQueryDependencies,
  teamId: Accessor<string | undefined>
) {
  const client = deps.client;
  const query = useInfiniteQuery(
    () => ({
      queryKey: soupKeys.crmPeople(teamId() ?? '').queryKey,
      enabled: !!teamId(),
      staleTime: 60_000,
      initialPageParam: null as string | null,
      queryFn: async ({ pageParam, signal }) => {
        const page = await throwOnErr(() =>
          deps.storage.getSoupItems({
            params: { cursor: pageParam },
            body: {
              ...QUERY_FILTERS_BASE,
              crm_company_filters: { hidden: false },
              limit: 20,
              sort_method: 'updated_at',
            },
          })
        );
        const companies = page.items.flatMap((item) =>
          item.tag === 'crmCompany' ? [item.data] : []
        );
        const people: CrmPerson[] = [];
        for (let offset = 0; offset < companies.length; offset += 4) {
          signal.throwIfAborted();
          const batch = await Promise.all(
            companies.slice(offset, offset + 4).map(async (company) => {
              const detail = await client.fetchQuery({
                queryKey: crmKeys.company(company.id).queryKey,
                staleTime: 60_000,
                queryFn: () =>
                  throwOnErr(() =>
                    deps.storage.getCompany({ companyId: company.id })
                  ),
              });
              return detail.hidden
                ? []
                : detail.contacts
                    .filter((contact) => !contact.hidden)
                    .map((contact) => ({
                      ...contact,
                      companyName:
                        detail.name ||
                        detail.domains[0]?.domain ||
                        'Unknown company',
                    }));
            })
          );
          people.push(...batch.flat());
        }
        return { people, nextCursor: page.next_cursor };
      },
      getNextPageParam: (page) => page.nextCursor,
    }),
    () => deps.client
  );

  // Drive progressive network pagination while this directory is mounted.
  createEffect(() => {
    if (query.hasNextPage && !query.isFetching && !query.isError) {
      void query.fetchNextPage();
    }
  });
  const people = () =>
    !query.isPending
      ? [
          ...new Map(
            query.data?.pages
              .flatMap((page) => page.people)
              .map((person) => [person.id, person]) ?? []
          ).values(),
        ]
      : [];
  return { query, people };
}
