import { updateUserAuth } from '@core/auth';
import {
  authenticateWithEmailPermissions,
  type TimeoutError,
} from '@core/auth/channel';
import { openEmailAuthPopup } from '@core/auth/email';
import { isErr } from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { emailClient } from '@service-email/client';
import type { Link } from '@service-email/generated/schemas';
import { updateUserInfo } from '@service-gql/client';
import { type UseQueryResult, useQuery } from '@tanstack/solid-query';
import { err, okAsync, ResultAsync } from 'neverthrow';
import { createMemo, createSignal } from 'solid-js';
import { queryClient } from '../../macro-entity/src/queries/client';

export const [emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

const EMAIL_LINKS_QUERY_KEY = ['email-links'];

async function fetchEmailLinks() {
  const result = await emailClient.getLinks();
  if (isErr(result)) {
    throw new Error('Failed to fetch email links', { cause: result[0] });
  }
  return result[1]?.links ?? [];
}

export function useEmailLinksQuery() {
  return useQuery(() => ({
    queryKey: EMAIL_LINKS_QUERY_KEY,
    queryFn: fetchEmailLinks,
    suspense: false,
    refetchOnMount: 'always',
  }));
}

function hasEmailLinks(query: UseQueryResult<Link[], Error>) {
  if (!query.data || query.error) {
    return false;
  }
  return query.data.length > 0;
}

export function useEmailLinksStatus() {
  const links = useEmailLinksQuery();
  return createMemo(() => {
    return hasEmailLinks(links);
  });
}

function invalidateEmailLinks() {
  queryClient.invalidateQueries({
    queryKey: EMAIL_LINKS_QUERY_KEY,
  });
  queryClient.cancelQueries({ queryKey: queryKeys.all.email });
  queryClient.setQueriesData({ queryKey: queryKeys.all.email }, () => ({
    pages: [],
    pageParams: [],
  }));
}

type EmailInitError =
  /** The email link has already been initialized*/
  | { tag: 'AlreadyInitialized' }
  | { tag: 'FailedToInitialize'; message: string };

/**
 * Calls email service to start syncing and initialize a new email link.
 *
 * @returns ok if syncing was started, err if syncing failed
 */
function initEmailLink(): ResultAsync<void, EmailInitError> {
  return ResultAsync.fromSafePromise(emailClient.init()).andThen(
    (initResult) => {
      if (isErr(initResult)) {
        const [errors] = initResult;
        const badRequestError = errors.find(
          // TODO: this is cope but seems like error.code not being set correctly
          (e) => e.code === '400' || e.message.includes('400')
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
    }
  );
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
      isErr(response) ? err('failed-to-disconnect') : okAsync(void 0)
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
    returnPath: '/app/login/popup/success',
  });

  return authenticateWithEmailPermissions();
}

/**
 * Hooks for interacting with email links.
 */
export function useEmailLinks() {
  const invalidations = async () => {
    invalidateEmailLinks();
    await updateUserAuth();
    await updateUserInfo();
  };

  const query = useEmailLinksQuery();

  return {
    query: query,
    isConnected: () => hasEmailLinks(query),
    initEmailLink: () =>
      initEmailLink().map(startEmailPolling).map(invalidations),
    connect: () =>
      connectEmail()
        .andThen(initEmailLink)
        .map(startEmailPolling)
        .andTee(invalidations),
    disconnect: () => disconnectEmail().andTee(invalidations),
    invalidate: () => invalidateEmailLinks(),
    refetchInterval: emailRefetchInterval,
  };
}
