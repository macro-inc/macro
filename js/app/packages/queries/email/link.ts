import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { emailClient } from '@service-email/client';
import {
  type ListLinksResponse,
  SyncStatus,
} from '@service-email/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { createMemo } from 'solid-js';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';

const LINK_STALE_TIME = 5 * 60 * 1000;

// A newly-linked inbox's avatar (`photo_url`) is written async, so poll the links
// list while any inbox is still syncing; polling stops on its own once none are,
// leaving steady-state/single-inbox users with no extra fetches.
const LINK_SYNC_POLL_INTERVAL = 2_000;

function isAnyInboxSyncing(data: ListLinksResponse | undefined): boolean {
  return (
    data?.links.some((link) => link.sync_status === SyncStatus.SYNCING) ?? false
  );
}

export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: emailKeys.links.queryKey,
    queryFn: async () => throwOnErr(async () => await emailClient.getLinks()),
    staleTime: LINK_STALE_TIME,
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      isAnyInboxSyncing(query.state.data) ? LINK_SYNC_POLL_INTERVAL : false,
  }));
}

/**
 * The link id of the user's primary inbox — their own `is_primary` link.
 * Delegated inboxes are primary for their own account, hence the macro_id
 * guard. `undefined` until links load or if none match.
 */
export function usePrimaryEmailLinkId() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo(() => {
    const uid = userId();
    if (!uid) return undefined;
    return linksQuery.data?.links.find(
      (link) => link.is_primary && link.macro_id === uid
    )?.id;
  });
}

/**
 * Returns a mapper from a target inbox link id to the `X-Email-Link-Id` value a
 * mutation should send: the link id when it targets a non-primary inbox, or
 * `undefined` for the primary inbox (the backend defaults to primary when the
 * header is absent). Use at mutation call sites to scope writes to the inbox the
 * user is acting in.
 */
export function useNonPrimaryEmailLinkIdHeader() {
  const primaryLinkId = usePrimaryEmailLinkId();
  return (linkId: string | undefined | null): string | undefined =>
    !linkId || linkId === primaryLinkId() ? undefined : linkId;
}

export function invalidateEmailLinks() {
  queryClient.cancelQueries({ queryKey: emailKeys.links.queryKey });
  queryClient.invalidateQueries({
    queryKey: emailKeys.links.queryKey,
  });
}

type RemoveInboxContext = { previousLinks: ListLinksResponse | undefined };
type RemoveInboxCallbacks = MutationCallbacks<
  void,
  Error,
  string,
  RemoveInboxContext
>;

/**
 * Removes a linked inbox, optimistically dropping its row from the cached links
 * list so the change is reflected immediately. Rolls the cache back on failure
 * and reconciles with the server on success.
 */
export function useRemoveInboxMutation(callbacks?: RemoveInboxCallbacks) {
  return useMutation(() => ({
    mutationFn: async (linkId: string) => {
      await throwOnErr(() => emailClient.deleteLink({ linkId }));
    },

    ...withCallbacks<void, Error, string, RemoveInboxContext>(
      {
        onMutate: async (linkId) => {
          await queryClient.cancelQueries({
            queryKey: emailKeys.links.queryKey,
          });

          const previousLinks = queryClient.getQueryData<ListLinksResponse>(
            emailKeys.links.queryKey
          );

          queryClient.setQueryData<ListLinksResponse>(
            emailKeys.links.queryKey,
            (old) =>
              old
                ? {
                    ...old,
                    links: old.links.filter((link) => link.id !== linkId),
                  }
                : undefined
          );

          return { previousLinks };
        },

        onSuccess: async () => {
          // Owned inboxes are torn down asynchronously, so the row still appears
          // in GET /email/links for a short window after the 204. Refetching links
          // here would resurrect the optimistically-removed row; instead leave the
          // optimistic cache in place and let the next focus refetch reconcile once
          // teardown completes.
          //
          // Clears a delegated inbox's threads immediately (its removal is a
          // synchronous edge drop). An owned inbox is torn down asynchronously,
          // so its threads are dropped when the `refresh_email` `link_removed`
          // event arrives after teardown — refetching now would race that.
          invalidateAllSoup();
          await invalidateUserInfo();
        },

        onError: (_error, _linkId, context) => {
          if (context?.previousLinks) {
            queryClient.setQueryData(
              emailKeys.links.queryKey,
              context.previousLinks
            );
          }
        },
      },
      callbacks
    ),
  }));
}
