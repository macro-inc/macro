import { useIsAuthenticated, useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { invalidateCalendarViews } from '@queries/calendar/sync';
import { queryClient } from '@queries/client';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { emailClient } from '@service-email/client';
import type { ListLinksResponse } from '@service-email/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createMemo } from 'solid-js';
import { queryReadyGate } from '../gate';
import { type MutationCallbacks, withCallbacks } from '../utils';
import { emailKeys } from './keys';
import { refreshMailAccounts } from './mail-accounts';

const LINK_STALE_TIME = 5 * 60 * 1000;

const HEALTH_PROBE_STALE_TIME = 15 * 60 * 1000;

const queryEnabled = () => true;

/**
 * Asks the server to probe each linked inbox's grant against Google and record its
 * health, so a grant that died while the user was away surfaces soon after they return
 * rather than waiting on the daily refresh. Runs on mount and on window focus, throttled
 * to once per stale-time window (the server also throttles per inbox). Fire-and-forget:
 * the refreshed `needs_reauth` is read by `useEmailLinksQuery`, which drives the reconnect
 * prompt — nothing renders from this query.
 */
export function useInboxHealthProbeQuery() {
  const authenticated = useIsAuthenticated();
  return useQuery(() => ({
    queryKey: emailKeys.linksHealthProbe.queryKey,
    queryFn: probeInboxHealth,
    enabled: authenticated() === true,
    staleTime: HEALTH_PROBE_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
  }));
}

async function probeInboxHealth() {
  await emailClient.healthCheckLinks();
  return null;
}

function fetchEmailLinks() {
  return throwOnErr(() => emailClient.getLinks());
}

export function useEmailLinksQuery(enabled: Accessor<boolean> = queryEnabled) {
  const authenticated = useIsAuthenticated();
  return useQuery(() => ({
    queryKey: emailKeys.links.queryKey,
    queryFn: fetchEmailLinks,
    enabled: authenticated() === true && enabled(),
    staleTime: LINK_STALE_TIME,
    refetchOnWindowFocus: 'always',
  }));
}

/**
 * The link id of the user's primary inbox — their own `is_primary` link.
 * Delegated inboxes are primary for their own account, hence the macro_id
 * guard. `undefined` until links load or if none match.
 */
export function findPrimaryEmailLinkId(
  links: readonly { id: string; is_primary: boolean; macro_id: string }[],
  userId: string | undefined
): string | undefined {
  if (!userId) return undefined;
  return links.find((link) => link.is_primary && link.macro_id === userId)?.id;
}

export function usePrimaryEmailLinkId() {
  const linksQuery = useEmailLinksQuery();
  const userId = useUserId();
  return createMemo(() => {
    // Offline GraphQL mail can render before this REST lookup completes.
    // Reading its pending resource would suspend the surrounding email view.
    if (!queryReadyGate(linksQuery)) return undefined;
    return findPrimaryEmailLinkId(linksQuery.data.links ?? [], userId());
  });
}

async function fetchMessageLinkId(messageId: string) {
  const message = await throwOnErr(() =>
    emailClient.getMessage({ message_id: messageId })
  );
  return message.link_id;
}

function messageInboxQueryOptions(messageId: string | undefined) {
  return {
    queryKey: emailKeys.messageInbox(messageId).queryKey,
    queryFn: () => (messageId ? fetchMessageLinkId(messageId) : null),
    enabled: messageId !== undefined,
    staleTime: LINK_STALE_TIME,
    retry: false,
  };
}

/**
 * The inbox a message belongs to. For a surface that holds a message id but
 * not the account that received it — an AI-drafted reply, whose tool
 * arguments name the message it answers — this is how it can show the sender
 * the reply will actually go out as. Exposes loading, failure and retry so
 * composers can require a known sender before sending.
 */
export function useMessageInboxQuery(messageId: Accessor<string | undefined>) {
  return useQuery(() => messageInboxQueryOptions(messageId()));
}

/** The `X-Email-Link-Id` value for a target inbox; see useNonPrimaryEmailLinkIdHeader. */
export function nonPrimaryEmailLinkIdHeader(
  linkId: string | undefined | null,
  primaryLinkId: string | undefined
): string | undefined {
  return !linkId || linkId === primaryLinkId ? undefined : linkId;
}

/**
 * The HTML signature configured for a given inbox, read straight from the links
 * query (`GET /email/links` → `link.settings.signature`) — no extra request.
 * `undefined` until links load, when no link matches, or when the inbox has no
 * signature set (the backend's `null` is normalized to `undefined`).
 */
export function useEmailSignature(
  linkId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const linksQuery = useEmailLinksQuery();
  return createMemo(() => {
    const id = linkId();
    if (!id || !queryReadyGate(linksQuery)) return undefined;
    return (
      linksQuery.data.links.find((link) => link.id === id)?.settings
        .signature ?? undefined
    );
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
  return (linkId: string | undefined | null) =>
    nonPrimaryEmailLinkIdHeader(linkId, primaryLinkId());
}

async function refreshSenderCatalog(): Promise<void> {
  try {
    await refreshMailAccounts();
  } catch (error) {
    Telemetry.error(error);
  }
}

export function invalidateEmailLinks() {
  // Connection, reauthorization and link-removal events must refresh the
  // GraphQL catalog consumed by both From and the sidebar, not only legacy reads.
  fireAndForget(refreshSenderCatalog(), 'email-links');
  queryClient.cancelQueries({ queryKey: emailKeys.links.queryKey });
  queryClient.invalidateQueries({
    queryKey: emailKeys.links.queryKey,
  });
}

type DisableCalendarCallbacks = MutationCallbacks<void, Error, string>;

/**
 * Turns calendar off for one inbox: the backend deletes its calendar data and
 * drops the calendar scopes from its Google grant. Publish the disabled state
 * only after deletion finishes: offering Enable while deletion holds the
 * inbox's grant lock makes the consent callback wait behind that deletion.
 */
export function useDisableCalendarMutation(
  callbacks?: DisableCalendarCallbacks
) {
  return useMutation(() => ({
    mutationFn: async (linkId: string) => {
      await throwOnErr(() => emailClient.disableLinkCalendar({ linkId }));
    },

    ...withCallbacks<void, Error, string>(
      {
        onSuccess: async (_data, linkId) => {
          await queryClient.cancelQueries({
            queryKey: emailKeys.links.queryKey,
          });

          queryClient.setQueryData<ListLinksResponse>(
            emailKeys.links.queryKey,
            (old) =>
              old && {
                ...old,
                links: old.links.map((link) =>
                  link.id === linkId
                    ? {
                        ...link,
                        calendar_disabled: true,
                        needs_calendar_permission: true,
                        has_calendar_data: false,
                      }
                    : link
                ),
              }
          );

          invalidateEmailLinks();
          invalidateCalendarViews();
        },
      },
      callbacks
    ),
  }));
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
