import { updateUserAuth } from '@core/auth';
import { toast } from '@core/component/Toast/Toast';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isErr, isOk, ok } from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { authServiceClient } from '@service-auth/client';
import { emailClient } from '@service-email/client';
import { updateUserInfo } from '@service-gql/client';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createMemo, createResource, createSignal } from 'solid-js';
import { queryClient } from '../../macro-entity/src/queries/client';
import { broadcastChannels, setBroadcastChannels } from './broadcastChannels';

export const [emailRefetchInterval, setEmailRefetchInterval] = createSignal<
  number | undefined
>();

const emailAuthResource = createSingletonRoot(() => {
  const fetchLink = async () => {
    return await authServiceClient.checkLinkExists({
      idp_name: 'google_gmail',
    });
  };
  return createResource(fetchLink, {
    initialValue: ok({ link_exists: false }),
  });
});

export const useEmailAuthStatus = createSingletonRoot(() => {
  const [resource] = emailAuthResource();
  return createMemo(() => {
    const result = resource.latest;

    if (isOk(result)) return result[1].link_exists;

    return false;
  });
});

export async function refetchEmailAuthStatus(force = false) {
  const [resource, { refetch }] = emailAuthResource();
  if (force) return refetch();
  if (resource.loading) return resource.latest;

  return refetch();
}

export async function connectEmail() {
  if (!broadcastChannels().get('auth')) {
    const channel = new BroadcastChannel('auth');
    setBroadcastChannels(broadcastChannels().set('auth', channel));
  }
  const channel = broadcastChannels().get('auth');

  const idpName = 'google_gmail';
  const originalUrl = `${window.location.origin}/app/login/popup/success`;

  const width = 600;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const ssoUrl = `${SERVER_HOSTS['auth-service']}/login/sso?idp_name=${idpName}&original_url=${originalUrl}`;

  window.open(
    ssoUrl,
    '_blank',
    `width=${width},height=${height},left=${left},top=${top}`
  );

  if (!channel) return;

  return new Promise((resolve) => {
    channel.onmessage = async (event) => {
      if (event.data.type === 'login-success') {
        const syncResult = await emailClient.init();
        if (isErr(syncResult) && !isErr(syncResult, 'HTTP_ERROR')) {
          toast.failure('Failed to connect to Gmail account');
        } else {
          toast.success(
            'Gmail account connected. Starting to sync your emails.',
            'If you have lots of emails this may take a few hours to complete.'
          );
          // We start polling for emails every second for the next 20 seconds
          setEmailRefetchInterval(1000);
          setTimeout(() => {
            setEmailRefetchInterval(undefined);
          }, 20000);
          await refetchEmailAuthStatus();
          await updateUserAuth();
          await updateUserInfo();
          resolve(true);
        }
      }
    };
  });
}

export async function disconnectEmail() {
  const response = await emailClient.stopSync();
  if (isErr(response) && !isErr(response, 'NOT_FOUND')) {
    toast.failure(
      'Failed to disconnect Gmail account',
      'Please try again later'
    );
  } else {
    toast.success(
      'Gmail account disconnected. Deleting your email data...',
      'This may take a little while to complete.'
    );
    refetchEmailAuthStatus();
    setEmailRefetchInterval(undefined);
    await queryClient.cancelQueries({ queryKey: queryKeys.all.email });
    queryClient.setQueriesData({ queryKey: queryKeys.all.email }, () => ({
      pages: [],
      pageParams: [],
    }));
    // stop any polling
    refetchEmailAuthStatus();
  }
}
