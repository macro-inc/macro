import { withAnalytics } from '@coparse/analytics';
import { authServiceClient } from '@service-auth/client';
import { authKeys } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { createCallback } from '@solid-primitives/rootless';

const { track, TrackingEvents } = withAnalytics();

export function useLogout() {
  return createCallback(async (redirectUrl?: string) => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';

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

    track(TrackingEvents.AUTH.LOGOUT);
    if (redirectUrl) window.location.href = redirectUrl;
  });
}
