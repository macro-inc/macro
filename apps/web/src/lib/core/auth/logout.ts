import { clearMcpAuthAttempts } from '@app/features/settings/mcp-auth-attempt';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { syncLoginStorage } from '@core/util/cookies';
import { clearPostLoginRedirect } from '@core/util/postLoginRedirect';
import { clearRegisteredCaches } from '@graphql-cache/lifecycle';
import { rotateCacheScope } from '@graphql-cache/scope';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient, queryPersistence } from '@queries/client';
import { clearDocumentQueryCache } from '@queries/storage/document-cache';
import { clearOfflineDocumentContexts } from '@queries/storage/documentLoad/offline-context-runtime';
import { authServiceClient } from '@service-auth/client';
import { raceTimeout } from '@solid-primitives/promise';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';
import { clearComposerStorage } from './clear-composer-storage';
import { unregisterPushRegistrationsForLogout } from './push-registration-lifecycle';

const unauthenticatedUserInfo: UserInfoData = {
  id: '',
  permissions: [],
  email: '',
  name: null,
  licenseStatus: 'inactive',
  tutorialComplete: false,
  group: null,
  hasChromeExt: false,
  authenticated: false,
  userId: '',
  hasTrialed: false,
  aiDataConsent: false,
  referralCode: '',
  createdAt: undefined,
};

export async function clearLocalAuthSession() {
  document.cookie =
    'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
  syncLoginStorage(false);
  const documentContextsCleared = clearOfflineDocumentContexts();
  clearDocumentQueryCache(queryClient);
  // Start every wipe before waiting, including stores not hydrated this session.
  const results = await Promise.allSettled([
    Promise.resolve().then(clearComposerStorage),
    documentContextsCleared,
    clearRegisteredCaches(),
    queryPersistence.clear(),
  ]);
  if (results.some((result) => result.status === 'rejected')) {
    await rotateCacheScope();
  }
  queryClient.setQueryData(authKeys.userInfo.queryKey, unauthenticatedUserInfo);
  clearMcpAuthAttempts();
}

export function useLogout() {
  const analytics = useAnalytics();
  const navigate = useNavigate();

  return createCallback(async () => {
    clearPostLoginRedirect();
    // Must run before the session is torn down — the unregister call is
    // authenticated. Time-boxed so a hung request can't block logout.
    await raceTimeout(unregisterPushRegistrationsForLogout(), 3000);
    await clearLocalAuthSession();
    await authServiceClient.logout();
    analytics.track('sign_out');
    analytics.reset();

    if (isNativeMobilePlatform()) {
      await fetch(SERVER_HOSTS['auth-logout'], {
        credentials: 'include',
        mode: 'no-cors',
        redirect: 'manual',
      }).catch(() => {});
      navigate('/login');
    } else {
      window.location.href = SERVER_HOSTS['auth-logout'];
    }
  });
}
