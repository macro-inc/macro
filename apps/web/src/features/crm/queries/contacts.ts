import { throwOnErr } from '@core/util/result';
import { soupKeys } from '@queries/soup/keys';
import type { CrmContactResponse } from '@service-storage/generated/schemas/crmContactResponse';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';

const CONTACT_STALE_TIME = 60 * 1000;

function crmContactByEmailQueryOptions(
  deps: CrmRecordDependencies,
  teamId: string,
  email: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  return queryOptions({
    queryKey: crmKeys.contactByEmail(teamId, normalizedEmail).queryKey,
    queryFn: async ({ signal }) => {
      const { contact } = await throwOnErr(() =>
        deps.storage.getContactByEmail({
          email: normalizedEmail,
          signal,
        })
      );
      if (contact) {
        deps.client.setQueryData(crmKeys.contact(contact.id).queryKey, contact);
      }
      return contact;
    },
    staleTime: CONTACT_STALE_TIME,
  });
}

/** Resolves a team CRM contact by email and primes its detail cache. */
export function useCrmContactByEmailQuery(
  deps: CrmRecordDependencies,
  teamId: Accessor<string>,
  email: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(
    () => ({
      ...crmContactByEmailQueryOptions(deps, teamId(), email()),
      enabled: enabled() && !!teamId() && !!email(),
    }),
    () => deps.client
  );
}

/**
 * Fetches a single CRM contact by id via `GET /crm/contacts/{id}`.
 * The endpoint is role-aware: admins/owners see hidden contacts too,
 * non-admins get 404 on hidden rows. The frontend doesn't branch — it
 * just calls the endpoint and trusts the response.
 */
export function useContactQuery(
  deps: CrmRecordDependencies,
  contactId: Accessor<string>
) {
  return useQuery(
    () => {
      const id = contactId();
      return {
        queryKey: crmKeys.contact(id).queryKey,
        queryFn: () => {
          if (!id) {
            throw new Error('contact id is required to fetch contact');
          }
          return throwOnErr(() => deps.storage.getContact({ contactId: id }));
        },
        staleTime: CONTACT_STALE_TIME,
        enabled: !!id,
      };
    },
    () => deps.client
  );
}

/**
 * Renames a contact via `PUT /crm/contacts/{id}/name`. Unlike company names
 * there is no global directory involved — `crm_contacts.name` is already
 * team-scoped, so the write is a plain overwrite. Optimistically updates the
 * contact detail cache (with rollback on error) so the title flips
 * immediately, then invalidates it plus the parent company (whose response
 * embeds the contact list) and soup so every listing picks up the new name.
 */
export function useSetContactNameMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        contactId,
        name,
      }: {
        contactId: string;
        companyId: string;
        name: string;
      }) => throwOnErr(() => deps.storage.setContactName({ contactId, name })),
      onMutate: async ({ contactId, name }) => {
        const queryKey = crmKeys.contact(contactId).queryKey;
        await deps.client.cancelQueries({ queryKey });
        const previous = deps.client.getQueryData<CrmContactResponse>(queryKey);
        if (previous) {
          deps.client.setQueryData<CrmContactResponse>(queryKey, {
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
          deps.client.setQueryData<CrmContactResponse>(
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
          deps.client.invalidateQueries({
            queryKey: crmKeys.contact(contactId).queryKey,
          }),
          deps.client.invalidateQueries({
            queryKey: crmKeys.company(companyId).queryKey,
          }),
          deps.client.invalidateQueries({ queryKey: soupKeys._def }),
        ]),
    }),
    () => deps.client
  );
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
export function useSetContactHiddenMutation(deps: CrmRecordDependencies) {
  return useMutation(
    () => ({
      mutationFn: ({
        contactId,
        hidden,
      }: {
        contactId: string;
        hidden: boolean;
      }) =>
        throwOnErr(() => deps.storage.setContactHidden({ contactId, hidden })),
      onSuccess: (_data, { contactId }) =>
        Promise.all([
          deps.client.invalidateQueries({ queryKey: soupKeys._def }),
          deps.client.invalidateQueries({
            queryKey: crmKeys.contact(contactId).queryKey,
          }),
        ]),
    }),
    () => deps.client
  );
}
