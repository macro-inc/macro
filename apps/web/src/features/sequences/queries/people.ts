import { fetchCrmContacts } from '@service-storage/crm-contacts';
import { keepPreviousData, queryOptions } from '@tanstack/solid-query';
import type { Person } from '../context/sequences-context';
import { SEQUENCE_LIMITS } from '../core/sequence';
import { sequenceKeys } from './keys';

async function searchPeople(search: string): Promise<Person[]> {
  const { contacts } = await fetchCrmContacts({
    search,
    limit: SEQUENCE_LIMITS.contacts,
  });
  return contacts.map((contact) => ({
    id: contact.id,
    name: contact.crmContactName ?? '',
    email: contact.email,
  }));
}

/** CRM People matching `search`, recently updated first when it is empty. */
export function peopleQueryOptions(search: string) {
  return queryOptions({
    queryKey: sequenceKeys.people(search).queryKey,
    queryFn: () => searchPeople(search),
    placeholderData: keepPreviousData,
  });
}
