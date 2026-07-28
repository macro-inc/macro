import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
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
 * Renames a contact via `PUT /crm/contacts/{id}/name`. Unlike company names
 * there is no global directory involved — `crm_contacts.name` is already
 * team-scoped, so the write is a plain overwrite. Optimistically updates the
 * contact detail cache (with rollback on error) so the title flips
 * immediately, then invalidates it plus the parent company (whose response
 * embeds the contact list) and soup so every listing picks up the new name.
 */
export function useSetContactNameMutation() {
  return useMutation(() => ({
    mutationFn: ({
      contactId,
      name,
    }: {
      contactId: string;
      companyId: string;
      name: string;
    }) =>
      throwOnErr(() =>
        storageServiceClient.setContactName({ contactId, name })
      ),
    onMutate: async ({ contactId, name }) => {
      const queryKey = crmKeys.contact(contactId).queryKey;
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CrmContactResponse>(queryKey);
      if (previous) {
        queryClient.setQueryData<CrmContactResponse>(queryKey, {
          ...previous,
          name,
        });
      }
      return { previous, optimisticName: name };
    },
    // Roll back only if the cache still holds this mutation's optimistic
    // name — a stale failure must not clobber a newer rename's update.
    onError: (_err, { contactId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData<CrmContactResponse>(
          crmKeys.contact(contactId).queryKey,
          (current) =>
            current?.name === context.optimisticName
              ? context.previous
              : current
        );
      }
    },
    onSettled: (_data, _err, { contactId, companyId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: crmKeys.contact(contactId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: crmKeys.company(companyId).queryKey,
        }),
        queryClient.invalidateQueries({ queryKey: soupKeys._def }),
      ]),
  }));
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
