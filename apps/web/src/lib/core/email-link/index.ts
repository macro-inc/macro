import { ROUTER_BASE_CONCAT, toBaseRelative } from '@app/constants/routerBase';
import { updateUserAuth } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { currentSettingsReturnTo } from '@core/constant/SettingsState';
import { getNativeMobilePlatform } from '@core/util/platform';
import { useInitGmailLink } from '@queries/auth';
import { invalidateUserInfo } from '@queries/auth/user-info';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import type { ConsentScopes } from '@service-auth/client';
import {
  ALREADY_INITIALIZED_CODE,
  emailClient,
  NO_GMAIL_GRANT_CODE,
  SHARED_INBOX_CONFLICT_CODE,
} from '@service-email/client';
import type {
  ListLinksResponse,
  ResyncResponse,
} from '@service-email/generated/schemas';
import type { UseQueryResult } from '@tanstack/solid-query';
import { invoke } from '@tauri-apps/api/core';
import { err, okAsync, ResultAsync } from 'neverthrow';
import { createMemo, createSignal } from 'solid-js';
import { rememberInboxLinkReturn } from './return-layout';
import { requestShareInboxConfirmation } from './share-conflict';

const [emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

function hasEmailLinks(query: UseQueryResult<ListLinksResponse, Error>) {
  if (!query.data || query.error) {
    return false;
  }
  return query.data.links.length > 0;
}

export function useEmailLinksStatus() {
  const query = useEmailLinksQuery();
  return createMemo(() => {
    return hasEmailLinks(query);
  });
}

type EmailInitError =
  /** The email link has already been initialized*/
  | { tag: 'AlreadyInitialized' }
  /** No Gmail grant to provision from — scope declined at consent or grant removed. */
  | { tag: 'NoGmailGrant' }
  /** The mailbox is already connected by another user; confirm to share it. */
  | { tag: 'SharedInboxConflict'; emailAddress: string; ownerEmail: string }
  | { tag: 'FailedToInitialize'; message: string };

function parseSharedInboxConflict(message: string): {
  emailAddress: string;
  ownerEmail: string;
} {
  try {
    const parsed = JSON.parse(message) as {
      emailAddress?: string;
      existingOwnerEmail?: string;
    };
    return {
      emailAddress: parsed.emailAddress ?? '',
      ownerEmail: parsed.existingOwnerEmail ?? '',
    };
  } catch {
    return { emailAddress: '', ownerEmail: '' };
  }
}

/**
 * Calls email service to start syncing and initialize a new email link.
 *
 * Pass `linkId` to complete a multi-inbox add via the `/link/gmail` flow — init will
 * read the `in_progress_user_link` row and provision a second `email_links` scoped to
 * that linked email. Omit for the first-time signup path.
 *
 * Pass `forceShare` to confirm promoting a mailbox another user already connected into
 * a shared inbox, after the user accepts the `SharedInboxConflict` prompt.
 *
 * @returns ok if syncing was started, err if syncing failed
 */
function initEmailLink(args?: {
  linkId?: string;
  forceShare?: boolean;
}): ResultAsync<void, EmailInitError> {
  return ResultAsync.fromSafePromise(
    emailClient.init({ linkId: args?.linkId, forceShare: args?.forceShare })
  ).andThen((initResult) => {
    if (initResult.isErr()) {
      const conflict = initResult.error.find(
        (e) => e.code === SHARED_INBOX_CONFLICT_CODE
      );
      if (conflict) {
        const conflictError: EmailInitError = {
          tag: 'SharedInboxConflict',
          ...parseSharedInboxConflict(conflict.message),
        };
        return err<void, EmailInitError>(conflictError);
      }
      if (initResult.error.some((e) => e.code === NO_GMAIL_GRANT_CODE)) {
        return err<void, EmailInitError>({ tag: 'NoGmailGrant' });
      }
      const error: EmailInitError = initResult.error.some(
        (e) => e.code === ALREADY_INITIALIZED_CODE
      )
        ? { tag: 'AlreadyInitialized' }
        : { tag: 'FailedToInitialize', message: 'Failed to initialize' };
      return err<void, EmailInitError>(error);
    }
    return okAsync<void, EmailInitError>(undefined);
  });
}

/**
 * The time in ms between making a polling fetch for
 * new emails during the sync process.
 */
const EMAIL_POLLING_INTERVAL = 1_000;

/**
 * How long in ms we should poll for emails during the sync process.
 */
const EMAIL_POLLING_TIMEOUT = 20_000;

/**
 * Starts a polling fetch for new emails during the sync process.
 */
function startEmailPolling() {
  if (emailRefetchInterval()) return;
  setEmailRefetchInterval(EMAIL_POLLING_INTERVAL);
  setTimeout(() => {
    stopEmailPolling();
  }, EMAIL_POLLING_TIMEOUT);
}

/**
 * Stops the polling fetch for new emails during the sync process.
 */
function stopEmailPolling() {
  setEmailRefetchInterval(undefined);
}

/**
 * Disconnects the email service and invalidates the email links query.
 *
 * NOTE: only to be used in development
 *
 * @returns ok if the email service was disconnected, err if it failed to disconnect
 */
function disconnectEmail(): ResultAsync<void, 'failed-to-disconnect'> {
  return ResultAsync.fromSafePromise(emailClient.stopSync()).andThen(
    (response) =>
      response.isErr() ? err('failed-to-disconnect') : okAsync(void 0)
  );
}

/**
 * Enqueues a fresh backfill for a linked inbox. Idempotent on the backend: a
 * no-op when a backfill is already in progress.
 *
 * @returns ok with the resync response, err if it failed
 */
function resyncInbox(
  linkId: string
): ResultAsync<ResyncResponse, 'failed-to-resync'> {
  return ResultAsync.fromSafePromise(
    emailClient.resyncLink({ linkId })
  ).andThen((response) =>
    response.isErr() ? err('failed-to-resync') : okAsync(response.value)
  );
}

/**
 * Initializes email syncing, starts polling, and invalidates relevant queries.
 * Unlike useEmailLinks().initEmailLink, this does not require SolidJS context.
 */
export function initAndStartEmailSync() {
  const invalidations = async () => {
    invalidateEmailLinks();
    await updateUserAuth();
    await invalidateUserInfo();
  };

  return initEmailLink().map(startEmailPolling).map(invalidations);
}

/**
 * The backend gates additional inboxes behind a paid subscription and answers
 * `POST /link/gmail` with 402 when the user isn't entitled. The auth client maps
 * that to a `PAYMENT_REQUIRED` error code; the add-inbox flow surfaces the
 * paywall instead of a generic failure so the backend stays the source of truth
 * on entitlement.
 */
function isPaymentRequired(errors: ReadonlyArray<{ code: string }>): boolean {
  return errors.some((error) => error.code === 'PAYMENT_REQUIRED');
}

/**
 * The backend answers `POST /link/gmail` with 429 when the user has too many
 * incomplete link attempts in flight (each abandoned OAuth leaves a pending row
 * that expires after 24h). The auth client maps that to `TOO_MANY_PENDING_LINKS`
 * so the flow can explain the wait instead of a dead-end generic failure.
 */
function isTooManyPendingLinks(
  errors: ReadonlyArray<{ code: string }>
): boolean {
  return errors.some((error) => error.code === 'TOO_MANY_PENDING_LINKS');
}

const TOO_MANY_PENDING_LINKS_MESSAGE =
  'Too many inbox connections in progress.';

/**
 * Starts the add-inbox flow: fetches the Gmail link authorization URL and
 * navigates the browser to the OAuth consent page. The callback returns to
 * `/inbox-link-callback`, which provisions the new link.
 *
 * `scopes` selects which permissions the consent screen asks for. Only calendar
 * entry points may request calendar access, and they pass `calendar` for an
 * inbox that is already connected so the user isn't shown mailbox permissions
 * they have already granted.
 *
 * On native iOS the OAuth runs inline in an `ASWebAuthenticationSession` via
 * the Tauri auth plugin (the app never navigates away), and the link is
 * provisioned here directly with the `link_id` from the init response. A
 * shared-inbox conflict is surfaced through `requestShareInboxConfirmation`,
 * rendered by the globally mounted dialog.
 *
 * Everywhere else — web and desktop — the consent screen replaces the page, so
 * the layout the user was working in is stashed against the new link id first
 * and the callback restores it. iOS needs no stash: its layout never unmounts.
 */
export function useAddInboxFlow() {
  const initGmailLink = useInitGmailLink();
  const { query, initEmailLink } = useEmailLinks();
  const { showPaywall } = usePaywallState();

  const completeNativeLink = async (linkId: string, forceShare: boolean) => {
    await initEmailLink({ linkId, forceShare }).match(
      async () => {
        await query.refetch();
        toast.success('Account connected');
      },
      async (error) => {
        if (error.tag === 'AlreadyInitialized') {
          await query.refetch();
          return;
        }
        if (error.tag === 'SharedInboxConflict' && !forceShare) {
          requestShareInboxConfirmation({
            emailAddress: error.emailAddress,
            ownerEmail: error.ownerEmail,
            onShare: () => void completeNativeLink(linkId, true),
          });
          return;
        }
        toast.failure('Failed to add inbox');
      }
    );
  };

  const startNativeFlow = async (scopes: ConsentScopes) => {
    const result = await initGmailLink.mutateAsync({
      originalUrl: 'macro://inbox-link-callback',
      scopes,
    });
    if (result.isErr()) {
      if (isPaymentRequired(result.error)) {
        showPaywall(PaywallKey.MULTI_INBOX);
        return;
      }
      if (isTooManyPendingLinks(result.error)) {
        toast.failure(TOO_MANY_PENDING_LINKS_MESSAGE);
        return;
      }
      toast.failure('Failed to start Gmail link flow');
      return;
    }

    let auth: { success: boolean; token?: string; error?: string };
    try {
      auth = await invoke('plugin:auth|authenticate', {
        payload: {
          authUrl: result.value.authorization_url,
          callbackScheme: 'macro',
          ephemeralSession: true,
        },
      });
    } catch (error) {
      console.error('add-inbox authenticate failed', error);
      toast.failure('Failed to add inbox');
      return;
    }

    if (!auth.success || !auth.token) {
      if (auth.error !== 'User canceled login') {
        toast.failure('Failed to add inbox');
      }
      return;
    }

    await completeNativeLink(result.value.link_id, false);
  };

  return async (options?: { scopes?: ConsentScopes }) => {
    const scopes = options?.scopes ?? 'gmail';
    if (getNativeMobilePlatform() === 'ios') {
      await startNativeFlow(scopes);
      return;
    }

    const callbackUrl = `${window.location.origin}${ROUTER_BASE_CONCAT}inbox-link-callback`;
    const result = await initGmailLink.mutateAsync({
      originalUrl: callbackUrl,
      scopes,
    });
    if (result.isOk()) {
      // Leaving for Google unloads the app, and the split layout only lives in
      // the URL — stash it so the callback can put it back rather than landing
      // everyone on a default layout.
      rememberInboxLinkReturn(result.value.link_id, {
        url: `${toBaseRelative(window.location.pathname)}${window.location.search}${window.location.hash}`,
        settingsReturnTo: currentSettingsReturnTo(),
      });
      window.location.href = result.value.authorization_url;
    } else if (isPaymentRequired(result.error)) {
      showPaywall(PaywallKey.MULTI_INBOX);
    } else if (isTooManyPendingLinks(result.error)) {
      toast.failure(TOO_MANY_PENDING_LINKS_MESSAGE);
    } else {
      toast.failure('Failed to start Gmail link flow');
    }
  };
}

/**
 * Hooks for interacting with email links.
 */
export function useEmailLinks() {
  const invalidations = async () => {
    invalidateEmailLinks();
    await updateUserAuth();
    await invalidateUserInfo();
  };

  const query = useEmailLinksQuery();

  return {
    query: query,
    isConnected: () => hasEmailLinks(query),
    initEmailLink: (args?: { linkId?: string; forceShare?: boolean }) =>
      initEmailLink(args).map(startEmailPolling).map(invalidations),
    disconnect: () => disconnectEmail().andTee(invalidations),
    resyncInbox: (linkId: string) =>
      resyncInbox(linkId).andTee(() => invalidateEmailLinks()),
    invalidate: () => invalidateEmailLinks(),
    refetchInterval: emailRefetchInterval,
  };
}
