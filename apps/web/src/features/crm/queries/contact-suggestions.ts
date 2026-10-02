import { throwOnErr } from '@core/util/result';
import type { CrmContactEntity } from '@entity';
import { queryReadyGate } from '@queries/gate';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const QUICK_ACCESS_CONTACTS_LIMIT = 500;
const STALE_TIME = 5 * 60 * 1000;

function toCrmContactEntity(contact: CrmContactResponse): CrmContactEntity {
  return {
    type: 'crm_contact',
    id: contact.id,
    name: contact.name || contact.email,
    ownerId: '',
    companyId: contact.companyId,
    email: contact.email,
    hidden: contact.hidden,
    createdAt: contact.createdAt,
    updatedAt: contact.lastInteraction,
  };
}

/**
 * Quick Access feed of the team's CRM contacts, most recently interacted
 * first, feeding the `'crm_contact'` bucket. Like the companies feed, it
 * widens the pool to contacts the user has never opened, up to a cap.
 */
export function useQuickAccessCrmContactsQuery(
  deps: CrmRecordDependencies,
  enabled: Accessor<boolean>
) {
  const query = useQuery(
    () => ({
      queryKey: crmKeys.quickAccessContacts.queryKey,
      queryFn: async ({ signal }) => {
        const { contacts } = await throwOnErr(() =>
          deps.storage.searchContacts({
            limit: QUICK_ACCESS_CONTACTS_LIMIT,
            signal,
          })
        );
        return contacts;
      },
      staleTime: STALE_TIME,
      enabled: enabled(),
    }),
    () => deps.client
  );

  const contacts = createMemo<CrmContactEntity[]>(() =>
    queryReadyGate(query) ? query.data.map(toCrmContactEntity) : []
  );

  return { query, contacts };
}
