import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { SERVER_HOSTS } from '@core/constant/servers';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { syncLoginStorage } from '@core/util/cookies';
import { clearRegisteredCaches } from '@graphql-cache/lifecycle';
import { authKeys } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { clearDocumentQueryCache } from '@queries/storage/document-cache';
import { authServiceClient } from '@service-auth/client';
import { createCallback } from '@solid-primitives/rootless';
import { useNavigate } from '@solidjs/router';

export function useLogout() {
  const analytics = useAnalytics();
  const navigate = useNavigate();

  return createCallback(async () => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
    syncLoginStorage(false);
    clearDocumentQueryCache(queryClient);

    queryClient.setQueryData(authKeys.userInfo.queryKey, {
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
    });

    // Queued mutations are user intent; never allow them to replay under a
    // subsequent account sharing this anonymous device cache scope.
    await clearRegisteredCaches();
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
