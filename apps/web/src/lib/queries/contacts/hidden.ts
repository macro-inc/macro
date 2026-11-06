import { useIsAuthenticated } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { contactsClient } from '@service-contacts/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, createSignal } from 'solid-js';
import { queryClient } from '../client';
import { contactsKeys } from './keys';

export type HiddenContactsResponse = { contacts: string[] };

const [hiddenContactIds, setHiddenContactIds] = createSignal<
  ReadonlySet<string>
>(new Set());

/** Contacts the signed-in user has hidden. Empty until the account query settles. */
export function hiddenContactIdSet(): ReadonlySet<string> {
  return hiddenContactIds();
}

export function hiddenContactsQueryOptions() {
  return {
    queryKey: contactsKeys.hidden.queryKey,
    queryFn: () =>
      throwOnErr(() => contactsClient.getHiddenContacts()).then(
        (response) => response ?? { contacts: [] }
      ),
  };
}

export function useHiddenContactsQuery() {
  const authenticated = useIsAuthenticated();
  return useQuery(() => ({
    ...hiddenContactsQueryOptions(),
    enabled: authenticated() === true,
  }));
}

/** Publishes the hidden-contact query into {@link hiddenContactIdSet}. */
export function useHiddenContactsSync() {
  const authenticated = useIsAuthenticated();
  const query = useHiddenContactsQuery();
  createEffect(() => {
    if (authenticated() !== true) {
      setHiddenContactIds(new Set<string>());
      return;
    }
    const contacts = query.data?.contacts;
    if (!contacts) return;
    setHiddenContactIds(new Set(contacts));
  });
}

function replaceHiddenContacts(contacts: string[]) {
  const next = { contacts };
  queryClient.setQueryData(contactsKeys.hidden.queryKey, next);
  setHiddenContactIds(new Set(contacts));
}

export function useSetContactHiddenMutation() {
  return useMutation(() => ({
    mutationFn: (input: { userId: string; hidden: boolean }) =>
      throwOnErr(() =>
        contactsClient.setContactHidden(input.userId, input.hidden)
      ),
    onMutate: (input) => {
      const previousHidden = queryClient.getQueryData<HiddenContactsResponse>(
        contactsKeys.hidden.queryKey
      );
      const previousContacts = queryClient.getQueryData<HiddenContactsResponse>(
        contactsKeys.all.queryKey
      );
      const previousIds = hiddenContactIds();
      const current = previousHidden?.contacts ?? [...previousIds];
      const ids = new Set(current);
      if (input.hidden) ids.add(input.userId);
      else ids.delete(input.userId);
      replaceHiddenContacts([...ids]);
      if (input.hidden && previousContacts) {
        queryClient.setQueryData<HiddenContactsResponse>(
          contactsKeys.all.queryKey,
          {
            contacts: previousContacts.contacts.filter(
              (id) => !isHiddenUserId(id, ids)
            ),
          }
        );
      }
      return { previousHidden, previousContacts, previousIds };
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData(
        contactsKeys.hidden.queryKey,
        context.previousHidden
      );
      queryClient.setQueryData(
        contactsKeys.all.queryKey,
        context.previousContacts
      );
      setHiddenContactIds(context.previousIds);
    },
    onSettled: () => {
      fireAndForget(
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: contactsKeys.hidden.queryKey,
          }),
          queryClient.invalidateQueries({
            queryKey: contactsKeys.all.queryKey,
          }),
        ]),
        'hidden-contacts'
      );
    },
  }));
}

/** True when `userId` is in `hidden`, ignoring id case. */
export function isHiddenUserId(
  userId: string,
  hidden: ReadonlySet<string>
): boolean {
  if (hidden.size === 0) return false;
  if (hidden.has(userId)) return true;
  const lower = userId.toLowerCase();
  if (hidden.has(lower)) return true;
  for (const id of hidden) {
    if (id.toLowerCase() === lower) return true;
  }
  return false;
}

/** The `macro|email` id a hidden-contact check uses for an address. */
export function hiddenContactIdForEmail(email: string): string | undefined {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return undefined;
  return `macro|${trimmed}`;
}

export function isHiddenContactEmail(
  email: string,
  hidden: ReadonlySet<string>
): boolean {
  const id = hiddenContactIdForEmail(email);
  return id !== undefined && isHiddenUserId(id, hidden);
}

/** The other person in a one-to-one direct message, when there is exactly one. */
export function directMessageCounterparty(
  channel: { channelType: string; participantIds?: readonly string[] },
  viewerId: string | undefined
): string | undefined {
  if (channel.channelType !== 'direct_message' || !viewerId) return undefined;
  const others = (channel.participantIds ?? []).filter(
    (id) => id !== viewerId && !id.startsWith('bot|')
  );
  return others.length === 1 ? others[0] : undefined;
}

/**
 * A one-to-one human direct message is hidden when either person is.
 * The viewer cannot hide themselves, so this is their conversation with
 * the hidden contact. Agent and group conversations stay visible.
 */
export function isHiddenDirectMessage(
  channel: { channelType: string; participantIds?: readonly string[] },
  hidden: ReadonlySet<string>
): boolean {
  if (channel.channelType !== 'direct_message' || hidden.size === 0) {
    return false;
  }
  const humans = (channel.participantIds ?? []).filter(
    (id) => !id.startsWith('bot|')
  );
  if (humans.length !== 2) return false;
  return humans.some((id) => isHiddenUserId(id, hidden));
}

/** Drops one-to-one direct messages with a hidden contact. */
export function withoutHiddenDirectMessages<
  T extends { channelType: string; participantIds?: readonly string[] },
>(channels: readonly T[], hidden: ReadonlySet<string>): T[] {
  if (hidden.size === 0) return channels as T[];
  let removed = false;
  const kept: T[] = [];
  for (const channel of channels) {
    if (isHiddenDirectMessage(channel, hidden)) {
      removed = true;
      continue;
    }
    kept.push(channel);
  }
  return removed ? kept : (channels as T[]);
}
