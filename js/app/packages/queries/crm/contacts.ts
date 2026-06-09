import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { soupKeys } from '../soup/keys';
import { crmKeys } from './keys';

const CONTACT_STALE_TIME = 60 * 1000;

/**
 * Fetches a single CRM contact by id via `GET /crm/contacts/{id}`.
 * The endpoint is role-aware: admins/owners see hidden contacts too,
 * non-admins get 404 on hidden rows. The frontend doesn't branch — it
 * just calls the endpoint and trusts the response.
 */
export function useContactQuery(contactId: Accessor<string>) {
  return useQuery(() => {
    const id = contactId();
    return {
      queryKey: crmKeys.contact(id).queryKey,
      queryFn: () => {
        if (!id) {
          throw new Error('contact id is required to fetch contact');
        }
        return throwOnErr(() =>
          storageServiceClient.getContact({ contactId: id })
        );
      },
      staleTime: CONTACT_STALE_TIME,
      enabled: !!id,
    };
  });
}

/**
 * Toggles `crm_contacts.hidden` via `PUT /crm/contacts/{id}/hidden`.
 * Hidden contacts disappear from the parent company's contact list
 * (non-admin view) and from any soup surface that filters them.
 *
 * Returns the invalidation promise from `onSuccess` so the mutation
 * stays pending until both the contact query and the soup queries
 * refetch — the toggle state and any dependent UI all flip in one beat.
 */
export function useSetContactHiddenMutation() {
  return useMutation(() => ({
    mutationFn: ({
      contactId,
      hidden,
    }: {
      contactId: string;
      hidden: boolean;
    }) =>
      throwOnErr(() =>
        storageServiceClient.setContactHidden({ contactId, hidden })
      ),
    onSuccess: (_data, { contactId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: soupKeys._def }),
        queryClient.invalidateQueries({
          queryKey: crmKeys.contact(contactId).queryKey,
        }),
      ]),
  }));
}
