import { updateUserAuth } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isErr, ok } from '@core/util/maybeResult';
import { emailClient } from '@service-email/client';
import { updateUserInfo } from '@service-gql/client';
import { raceTimeout } from '@solid-primitives/promise';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource, createSignal } from 'solid-js';
import { broadcastChannels, setBroadcastChannels } from './broadcastChannels';

export const [emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

const emailLinksResource = createSingletonRoot(() => {
  const fetchLinks = async () => {
    return await emailClient.getLinks();
  };
  return createResource(fetchLinks, {
    initialValue: ok({ links: [] }),
  });
});

// Returns true if user has at least one email link
export const useEmailLinksStatus = createSingletonRoot(() => {
  const [resource] = emailLinksResource();
  return createMemo(() => {
    if (isErr(resource.latest)) return false;
    const [, links] = resource.latest;
    return links.links.length > 0;
  });
});

export async function refetchEmailLinks(force = false) {
  const [resource, { refetch }] = emailLinksResource();
  if (force) return await refetch();
  if (resource.loading) return resource.latest;
  return await refetch();
}

const AUTH_CHANNEL = 'auth';
const LOGIN_SUCCESS = 'login-success';
const GOOGLE_GMAIL_IDP = 'google_gmail';

type AuthenticationState =
  | { type: 'not_authenticated' }
  | { type: 'authenticating' }
  | { type: 'authenticated' }
  | { type: 'authentication_failed' };

type EmailSyncState =
  | { type: 'idle' }
  | { type: 'syncing'; startTime: number; durationMs: number }
  | { type: 'finished' };

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

function getOrCreateAuthChannel(): BroadcastChannel {
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

const AUTHENTICATION_TIMEOUT = 30_000;

async function signUpWithEmailPermissions(): Promise<
  void | 'authentication_timeout'
> {
  const channel = getOrCreateAuthChannel();

  const originalUrl = `${window.location.origin}/app/login/popup/success`;
  openAuthPopup(GOOGLE_GMAIL_IDP, originalUrl);

  try {
    await raceTimeout(
      async () => await waitForAuthSuccess(channel),
      AUTHENTICATION_TIMEOUT,
      true
    );
  } catch (error) {
    console.error(error);
    return 'authentication_timeout';
  }

  return;
}

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
    return 'failed_to_get_links';
  }

  const [, links] = linksResponse;

  if (!hasEmailLinks(links)) {
    return 'no_links';
  }
  return 'success';
}

export function useSignUpAndConnectEmail() {
  const [authenticationState, setAuthenticationState] =
    createSignal<AuthenticationState>({ type: 'not_authenticated' });

  async function connect(): Promise<void> {
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
  }

  return [authenticationState, connect];
}

const EMAIL_POLLING_INTERVAL = 1000;
const EMAIL_POLLING_DURATION = 20_000;

type PollingInterface = {
  start: () => void;
  stop: () => void;
  pollingIntervalMs: number;
};

async function initEmailAndStartPolling({
  pollingInterface,
}: {
  pollingInterface: PollingInterface;
}): Promise<void | 'already_initialized' | 'failed_to_initialize'> {
  const initResult = await emailClient.init();

  if (isErr(initResult)) {
    const [error] = initResult;
    const badRequestError = error.find((err) => err.code === '400');
    if (badRequestError) {
      return 'already_initialized';
    } else {
      toast.failure('Failed to connect to Gmail account');
      return 'failed_to_initialize';
    }
  }

  pollingInterface.start();

  setTimeout(() => {
    pollingInterface.stop();
  }, pollingInterface.pollingIntervalMs);
}

export function useEmailInitializeAndPoll() {
  const [emailSyncState, setEmailSyncState] = createSignal<EmailSyncState>({
    type: 'idle',
  });

  const pollingInterface: PollingInterface = {
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
