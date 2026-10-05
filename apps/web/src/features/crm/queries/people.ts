import { queryReadyGate } from '@queries/gate';
import { type Accessor, createEffect } from 'solid-js';
import { type CrmPerson, deduplicatePeople } from '../core/people';
import { useCrmContactsQuery } from './contact-suggestions';
import type { CrmQueryDependencies } from './dependencies';

/** Progressively loads one deduplicated directory across all accessible teams. */
export function useCrmPeopleQuery(
  deps: CrmQueryDependencies,
  enabled: Accessor<boolean>
) {
  const query = useCrmContactsQuery(deps, enabled);
  // Synchronize the paged network source while the directory is mounted.
  createEffect(() => {
    if (enabled() && query.hasNextPage && !query.isFetching && !query.isError) {
      void query.fetchNextPage();
    }
  });
  const people = (): CrmPerson[] =>
    queryReadyGate(query)
      ? deduplicatePeople(
          query.data.pages.flatMap((page) =>
            page.contacts.map((contact) => ({
              id: contact.id,
              companyId: contact.companyId,
              companyName: contact.companyName,
              email: contact.email,
              name: contact.crmContactName,
              hidden: contact.hidden,
              firstInteraction: contact.firstInteraction,
              lastInteraction: contact.lastInteraction,
              createdAt: contact.createdAt,
              updatedAt: contact.updatedAt,
            }))
          )
        )
      : [];
  return { query, people };
}
