import { authServiceClient } from '@service-auth/client';
import { authKeys } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { SERVER_HOSTS } from '@core/constant/servers';
import { syncLoginStorage } from '@core/util/cookies';
import { createCallback } from '@solid-primitives/rootless';
import { useAnalytics } from '@app/component/analytics-context';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { useNavigate } from '@solidjs/router';

export function useLogout() {
  const analytics = useAnalytics();
  const navigate = useNavigate();

  return createCallback(async () => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
    syncLoginStorage(false);

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
