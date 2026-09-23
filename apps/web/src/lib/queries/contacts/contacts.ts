import type { IUser } from '@core/user/types';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { contactsClient } from '@service-contacts/client';
import { useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { contactsKeys } from './keys';

function contactsQueryOptions() {
  return {
    queryKey: contactsKeys.all.queryKey,
    queryFn: () => throwOnErr(() => contactsClient.getContacts()),
  };
}

/** The raw contacts query — for callers that need its loading state. */
export function useContactsQuery(enabled: Accessor<boolean> = () => true) {
  return useQuery(() => ({ ...contactsQueryOptions(), enabled: enabled() }));
}

/**
 * Returns contacts as IUser objects.
 * Compatible with the previous createResource-based implementation.
 */
export function useContacts(
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const query = useContactsQuery(enabled);
  return createMemo(() => {
    if (!query.isSuccess) return [];
    const contacts = query.data.contacts;
    return contacts.map((c) => ({
      id: c,
      email: idToEmail(c),
      name: idToDisplayName(c),
    }));
  });
}

export function invalidateContacts() {
  return queryClient.invalidateQueries(contactsQueryOptions());
}
