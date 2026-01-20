import { withAnalytics } from '@coparse/analytics';
import { authServiceClient } from '@service-auth/client';
import { invalidateUserInfo, authKeys } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { createCallback } from '@solid-primitives/rootless';
import { invalidateOrganization } from '@queries/auth';

const { track, TrackingEvents } = withAnalytics();

export function useLogout() {
  return createCallback(async (redirectUrl?: string) => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';

    // Reset user info query cache to unauthenticated state
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

    invalidateOrganization();

    await authServiceClient.logout();
    invalidateUserInfo();

    track(TrackingEvents.AUTH.LOGOUT);
    if (redirectUrl) window.location.href = redirectUrl;
  });
}
