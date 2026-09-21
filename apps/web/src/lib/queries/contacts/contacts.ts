import type { IUser } from '@core/user/types';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { contactsClient } from '@service-contacts/client';
import type { GetContactsResponse } from '@service-contacts/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { contactsKeys } from './keys';

function contactsQueryOptions() {
  return {
    queryKey: contactsKeys.all.queryKey,
    queryFn: () => throwOnErr(() => contactsClient.getContacts()),
  };
}

/** The raw contacts query — for callers that need its loading state. */
export function useContactsQuery() {
  return useQuery(() => contactsQueryOptions());
}

/**
 * Returns contacts as IUser objects.
 * Compatible with the previous createResource-based implementation.
 */
export function useContacts(): Accessor<IUser[]> {
  const query = useContactsQuery();
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

type SetContactHiddenVars = {
  /** The contact's macro user id (`macro|name@example.com`). */
  userId: string;
  hidden: boolean;
};

type SetContactHiddenContext = { previous: GetContactsResponse | undefined };

/**
 * Hides a contact from (or restores it to) the current user's recipient
 * suggestions, e.g. a mistyped address that keeps bouncing. Hiding drops the
 * row from the cached list right away; the server's `contacts_invalidation`
 * push and the settled refetch reconcile the rest.
 */
export function useSetContactHiddenMutation(
  callbacks?: MutationCallbacks<
    void,
    Error,
    SetContactHiddenVars,
    SetContactHiddenContext
  >
) {
  return useMutation(() => ({
    mutationFn: ({ userId, hidden }: SetContactHiddenVars) =>
      throwOnErr(() => contactsClient.setContactHidden(userId, hidden)),
    ...withCallbacks<
      void,
      Error,
      SetContactHiddenVars,
      SetContactHiddenContext
    >(
      {
        onMutate: async ({ userId, hidden }) => {
          await queryClient.cancelQueries(contactsQueryOptions());
          const previous = queryClient.getQueryData<GetContactsResponse>(
            contactsKeys.all.queryKey
          );
          if (hidden) {
            queryClient.setQueryData<GetContactsResponse>(
              contactsKeys.all.queryKey,
              (old) =>
                old && {
                  ...old,
                  contacts: old.contacts.filter((c) => c !== userId),
                }
            );
          }
          return { previous };
        },
        onError: (_error, _vars, context) => {
          if (context?.previous) {
            queryClient.setQueryData(
              contactsKeys.all.queryKey,
              context.previous
            );
          }
        },
        onSettled: () => invalidateContacts(),
      },
      callbacks
    ),
  }));
}
