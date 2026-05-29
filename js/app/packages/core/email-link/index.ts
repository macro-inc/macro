import { ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { updateUserAuth } from '@core/auth';
import {
  authenticateWithEmailPermissions,
  type TimeoutError,
} from '@core/auth/channel';
import { openEmailAuthPopup } from '@core/auth/email';

import { invalidateUserInfo } from '@queries/auth/user-info';
import { invalidateEmailLinks, useEmailLinksQuery } from '@queries/email/link';
import { emailClient } from '@service-email/client';
import type {
  ListLinksResponse,
  ResyncResponse,
} from '@service-email/generated/schemas';
import type { UseQueryResult } from '@tanstack/solid-query';
import { err, okAsync, ResultAsync } from 'neverthrow';
import { createMemo, createSignal } from 'solid-js';

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
  | { tag: 'FailedToInitialize'; message: string };

/**
 * Calls email service to start syncing and initialize a new email link.
 *
 * Pass `linkId` to complete a multi-inbox add via the `/link/gmail` flow — init will
 * read the `in_progress_user_link` row and provision a second `email_links` scoped to
 * that linked email. Omit for the first-time signup path.
 *
 * @returns ok if syncing was started, err if syncing failed
 */
function initEmailLink(args?: {
  linkId?: string;
}): ResultAsync<void, EmailInitError> {
  return ResultAsync.fromSafePromise(
    emailClient.init({ linkId: args?.linkId })
  ).andThen((initResult) => {
    if (initResult.isErr()) {
      const badRequestError = initResult.error.find(
        // TODO: this is cope but seems like error.code not being set correctly
        (e) => e.message.includes('400')
      );
      return err(
        badRequestError
          ? { tag: 'AlreadyInitialized' as const }
          : {
              tag: 'FailedToInitialize' as const,
              message: 'Failed to initialize',
            }
      );
    }
    return okAsync(undefined);
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
 * Removes a linked inbox. For an owned inbox the backend cascades the full
 * teardown; for a delegated inbox it only drops the delegation edge.
 *
 * @returns ok if the inbox was removed, err if it failed
 */
function removeInbox(linkId: string): ResultAsync<void, 'failed-to-remove'> {
  return ResultAsync.fromSafePromise(
    emailClient.deleteLink({ linkId })
  ).andThen((response) =>
    response.isErr() ? err('failed-to-remove') : okAsync(void 0)
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
 * Connects to the email service and authenticates with email permissions.
 *
 * @returns A promise that resolves when the auth success message is received.
 */
function connectEmail(): ResultAsync<void, TimeoutError> {
  openEmailAuthPopup({
    idpName: 'google_gmail',
    returnPath: `${ROUTER_BASE_CONCAT}login/popup/success`,
  });

  return authenticateWithEmailPermissions();
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
    initEmailLink: (args?: { linkId?: string }) =>
      initEmailLink(args).map(startEmailPolling).map(invalidations),
    connect: () =>
      connectEmail()
        .andThen(() => initEmailLink())
        .map(startEmailPolling)
        .andTee(invalidations),
    disconnect: () => disconnectEmail().andTee(invalidations),
    removeInbox: (linkId: string) => removeInbox(linkId).andTee(invalidations),
    resyncInbox: (linkId: string) =>
      resyncInbox(linkId).andTee(() => invalidateEmailLinks()),
    invalidate: () => invalidateEmailLinks(),
    refetchInterval: emailRefetchInterval,
  };
}
