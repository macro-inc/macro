import { updateUserAuth, useIsAuthenticated } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isErr, ok } from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';
import { updateUserInfo } from '@service-gql/client';
import { raceTimeout } from '@solid-primitives/promise';
import { createSingletonRoot } from '@solid-primitives/rootless';
import {
  type Accessor,
  createMemo,
  createResource,
  createSignal,
} from 'solid-js';
import { queryClient } from '../../../macro-entity/src/queries/client';
import { broadcastChannels, setBroadcastChannels } from '../broadcastChannels';

export const [emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

/**
 * Resource that tracks any email links that the user has.
 */
const emailLinksResource = createSingletonRoot(() => {
  const fetchLinks = async () => {
    return await emailClient.getLinks();
  };
  return createResource(fetchLinks, {
    initialValue: ok({ links: [] }),
  });
});

/**
 * Returns true if user has at least one email link
 */
export const useEmailLinksStatus = createSingletonRoot(() => {
  const [resource] = emailLinksResource();
  return createMemo(() => {
    if (isErr(resource.latest)) return false;
    const [, links] = resource.latest;
    return links.links.length > 0;
  });
});

/**
 * Refetches the email links resource.
 *
 * @param force - Forces a refetch even if the resource is already loading.
 * @returns A promise that resolves when the resource has been refetched.
 */
export async function refetchEmailLinks(force = false) {
  const [resource, { refetch }] = emailLinksResource();
  if (force) return await refetch();
  if (resource.loading) return resource.latest;
  return await refetch();
}

const AUTH_CHANNEL = 'auth';
const LOGIN_SUCCESS = 'login-success';
const GOOGLE_GMAIL_IDP = 'google_gmail';

export type EmailAuthenticationState =
  | { type: 'not_authenticated' }
  | { type: 'authenticating' }
  | { type: 'authenticated' }
  | { type: 'authentication_failed' };

type EmailSyncState =
  | { type: 'idle' }
  | { type: 'syncing'; startTime: number; durationMs: number }
  | { type: 'finished' };

/**
 * Opens an oauth popup window for the given IDP.
 *
 * @param idpName - The name of the IDP to open.
 * @param returnUrl - The URL to return to after authentication.
 * @returns The window object of the opened popup, or null if it failed to open.
 */
function openAuthPopup(idpName: string, returnUrl: string): Window | null {
  const width = 600;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const ssoUrl = `${SERVER_HOSTS['auth-service']}/login/sso?idp_name=${idpName}&original_url=${returnUrl}`;

  return window.open(
    ssoUrl,
    '_blank',
    `width=${width},height=${height},left=${left},top=${top}`
  );
}

/**
 * Gets or creates a broadcast channel for the authentication process.
 *
 * @returns The broadcast channel.
 */
export function getOrCreateAuthChannel(): BroadcastChannel {
  let channel = broadcastChannels().get(AUTH_CHANNEL);
  if (!channel) {
    channel = new BroadcastChannel(AUTH_CHANNEL);
    setBroadcastChannels(broadcastChannels().set(AUTH_CHANNEL, channel));
  }
  return channel;
}

function waitForAuthSuccess(channel: BroadcastChannel): Promise<void> {
  return new Promise((resolve) => {
    channel.onmessage = (event) => {
      if (event.data.type === LOGIN_SUCCESS) {
        resolve();
      }
    };
  });
}

const AUTHENTICATION_TIMEOUT = 60_000;

/**
 * Signs up the user with email permissions.
 *
 * @returns A promise that resolves when the user has been signed up.
 */
async function signUpWithEmailPermissions(): Promise<
  void | 'authentication_timeout'
> {
  const channel = getOrCreateAuthChannel();

  const originalUrl = `${window.location.origin}/app/login/popup/success`;
  openAuthPopup(GOOGLE_GMAIL_IDP, originalUrl);

  try {
    await raceTimeout(
      waitForAuthSuccess(channel),
      AUTHENTICATION_TIMEOUT,
      true
    );
  } catch (error) {
    logger.error(
      '[email] failed to authenticate with google gmail after sign up',
      { error }
    );
    return 'authentication_timeout';
  }

  return;
}

/**
 * Checks if the user has email links.
 *
 * @param links - The links to check.
 * @returns True if the user has at least one email link, false otherwise.
 */
function hasEmailLinks(
  links: Awaited<ReturnType<typeof emailClient.getLinks>>[1]
) {
  return (links?.links?.length ?? 0) > 0;
}

async function ensureSuccessfulLink(): Promise<
  'success' | 'failed_to_get_links' | 'no_links'
> {
  const linksResponse = await emailClient.getLinks();

  if (isErr(linksResponse)) {
    logger.error('[email] failed to get email links after sign up');
    return 'failed_to_get_links';
  }

  const [, links] = linksResponse;

  if (!hasEmailLinks(links)) {
    logger.error('[email] expected at least one email link after sign up');
    return 'no_links';
  }
  return 'success';
}

/**
 * Connect email to an already authenticated user.
 *
 * NOTE: because of the way this works, if a user selects a different email
 * than the one they originally signed up with, they will be signed out and
 * back in with the new email.
 */
export async function connectEmail(): Promise<void> {
  const authResult = await signUpWithEmailPermissions();

  if (authResult === 'authentication_timeout') {
    toast.failure(
      'Authentication timed out.',
      'Please email contact@macro.com'
    );
    return;
  }

  if ((await ensureSuccessfulLink()) !== 'success') {
    toast.failure(
      'Failed to connect to Gmail account.',
      'Please email contact@macro.com'
    );
    return;
  }

  await updateUserAuth();
  await updateUserInfo();
  await refetchEmailLinks();
}

/**
 * Disconnect email from an already authenticated user.
 *
 * NOTE: should only be used in dev for testing purposes.
 */
export async function disconnectEmail() {
  const response = await emailClient.stopSync();
  if (isErr(response) && !isErr(response, 'NOT_FOUND')) {
    toast.failure(
      'Failed to disconnect Gmail account',
      'Please try again later'
    );
    return;
  }

  toast.success(
    'Gmail account disconnected. Deleting your email data...',
    'This may take a little while to complete.'
  );

  refetchEmailLinks();
  setEmailRefetchInterval(undefined);
  await queryClient.cancelQueries({ queryKey: queryKeys.all.email });
  queryClient.setQueriesData({ queryKey: queryKeys.all.email }, () => ({
    pages: [],
    pageParams: [],
  }));
  refetchEmailLinks();
}

/**
 * Hook that handles the email authentication process.
 *
 * @returns A tuple containing an accessor for the authentication state and a function to sign up and connect the email.
 */
export function useSignUpAndConnectEmail(): [
  Accessor<EmailAuthenticationState>,
  () => Promise<void>,
] {
  const isAlreadyAuthenticated = useIsAuthenticated();

  const DEFAULT_AUTHENTICATION_STATE: EmailAuthenticationState = {
    type: isAlreadyAuthenticated() ? 'authenticated' : 'not_authenticated',
  };

  const [authenticationState, setAuthenticationState] =
    createSignal<EmailAuthenticationState>(DEFAULT_AUTHENTICATION_STATE);

  async function connect(): Promise<void> {
    if (
      authenticationState().type === 'authenticating' ||
      authenticationState().type === 'authenticated'
    ) {
      console.warn('user is already authenticated');
      return;
    }

    const authResult = await signUpWithEmailPermissions();

    if (authResult === 'authentication_timeout') {
      toast.failure('Authentication timed out. Please email contact@macro.com');
      setAuthenticationState({ type: 'authentication_failed' });
      return;
    }

    if ((await ensureSuccessfulLink()) !== 'success') {
      toast.failure(
        'Failed to connect to Gmail account. Please email contact@macro.com'
      );
      setAuthenticationState({ type: 'authentication_failed' });
      return;
    }

    await updateUserAuth();
    await updateUserInfo();
    await refetchEmailLinks();

    setAuthenticationState({ type: 'authenticated' });
  }

  return [authenticationState, connect];
}

const EMAIL_POLLING_INTERVAL = 1000;
const EMAIL_POLLING_DURATION = 20_000;

type PollingConfig = {
  start: () => void;
  stop: () => void;
  /** How long we should poll for new emails */
  pollingIntervalMs: number;
};

/**
 * Initializes the email client and starts polling for syncing emails
 *
 * @param pollingInterface - The polling configuration.
 * @returns A promise that resolves when the email client has been initialized and polling has started.
 */
async function initEmailAndStartPolling({
  pollingInterface,
}: {
  pollingInterface: PollingConfig;
}): Promise<void | 'already_initialized' | 'failed_to_initialize'> {
  const initResult = await emailClient.init();

  if (isErr(initResult)) {
    const [error] = initResult;
    const badRequestError = error.find((err) => err.code === '400');
    if (badRequestError) {
      return 'already_initialized';
    } else {
      logger.error('[email] failed to initialize email client after sign up', {
        err: error,
      });
      toast.failure('Failed to connect to Gmail account');
      return 'failed_to_initialize';
    }
  }

  pollingInterface.start();

  setTimeout(() => {
    pollingInterface.stop();
  }, pollingInterface.pollingIntervalMs);
}

/**
 * Hook that initializes the email client and starts polling for syncing emails
 *
 * @returns A tuple containing the email sync state and a function to initialize and start polling.
 */
export function useEmailInitializeAndPoll() {
  const [emailSyncState, setEmailSyncState] = createSignal<EmailSyncState>({
    type: 'idle',
  });

  const pollingInterface: PollingConfig = {
    start: () => {
      setEmailRefetchInterval(EMAIL_POLLING_INTERVAL);
      setEmailSyncState({
        type: 'syncing',
        startTime: Date.now(),
        durationMs: EMAIL_POLLING_DURATION,
      });
    },
    stop: () => {
      setEmailSyncState({ type: 'finished' });
    },
    pollingIntervalMs: EMAIL_POLLING_INTERVAL,
  };

  return [emailSyncState, () => initEmailAndStartPolling({ pollingInterface })];
}
