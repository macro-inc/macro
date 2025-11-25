import { updateUserAuth } from '@core/auth';
import {
  authenticateWithEmailPermissions,
  type TimeoutError,
} from '@core/auth/channel';
import { openEmailAuthPopup } from '@core/auth/email';
import { isErr } from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { emailClient } from '@service-email/client';
import type { Link } from '@service-email/generated/schemas/link';
import { updateUserInfo } from '@service-gql/client';
import { useQuery } from '@tanstack/solid-query';
import { err, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { queryClient } from '../../macro-entity/src/queries/client';

const [_emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

export const emailRefetchInterval = _emailRefetchInterval;

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
  }));
}

export function useEmailLinksStatus() {
  return () => {
    const links = useEmailLinksQuery();
    return links.isSuccess && links.data?.length > 0;
  };
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

/** Arbitrary threshold in ms between created_at and updated_at */
const CREATED_UPDATED_AT_THRESHOLD = 1_000;

/**
 * Try and determine if the link is the first time it was created
 * by checking if the created_at and updated_at are within the threshold
 */
function isFirstTimeEmailLink(link: Link) {
  const createdAt = new Date(link.created_at);
  const updatedAt = new Date(link.updated_at);

  return (
    createdAt.getTime() - updatedAt.getTime() < CREATED_UPDATED_AT_THRESHOLD
  );
}

/** Returns true if the link needs to be synced */
function linkNeedsSync(link: Link) {
  return link.is_sync_active === false && isFirstTimeEmailLink(link);
}

/** Returns true if any of the links need to be synced */
function anyLinksNeedSync(links: Link[]) {
  return links.some(linkNeedsSync);
}

type EmailSyncError =
  /** The email link has already been initialized*/
  | { tag: 'AlreadyInitialized' }
  | { tag: 'FailedToInitialize'; message: string };

/**
 * Calls email service to start syncing and initialize a new email link.
 *
 * @returns ok if syncing was started, err if syncing failed
 */
async function syncEmails(): Promise<Result<void, EmailSyncError>> {
  const initResult = await emailClient.init();

  if (isErr(initResult)) {
    const [errors] = initResult;
    const badRequestError = errors.find((err) => err.code === '400');
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
 * Starts syncing and polling emails if there is a new link
 *
 * @returns true if syncing emails was started
 */
function maybeStartEmailSync(links: Link[]): boolean {
  if (!anyLinksNeedSync(links)) {
    return false;
  }
  syncEmails();
  startEmailPolling();
  return true;
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

  return {
    query: useEmailLinksQuery(),
    status: useEmailLinksStatus(),
    connect: () => connectEmail().andTee(invalidations),
    disconnect: () => disconnectEmail().andTee(invalidations),
    maybeSync: maybeStartEmailSync,
    invalidate: () => invalidateEmailLinks(),
    refetchInterval: emailRefetchInterval,
  };
}
