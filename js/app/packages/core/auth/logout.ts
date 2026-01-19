import { withAnalytics } from '@coparse/analytics';
import { useAuthUserInfo } from '@core/auth';
import { useOrganization } from '@core/user';
import { authServiceClient } from '@service-auth/client';
import { invalidateUserInfo, authKeys } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { createCallback } from '@solid-primitives/rootless';

const { track, TrackingEvents } = withAnalytics();

export function useLogout() {
  const [, { mutate: mutateAuthUserInfo }] = useAuthUserInfo();
  const [, { mutate: mutateOrganization }] = useOrganization();

  return createCallback(async (redirectUrl?: string) => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
    // Reset authenticated user permissions
    mutateAuthUserInfo(() => [
      null,
      {
        id: '',
        userId: '',
        authenticated: false,
        permissions: [],
        email: '',
        name: null,
        licenseStatus: '',
        tutorialComplete: false,
        group: null,
        hasChromeExt: false,
        hasTrialed: false,
      },
    ]);

    // Reset user info query cache
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

    mutateOrganization(() => ({
      organizationId: undefined,
      organizationName: undefined,
    }));

    await authServiceClient.logout();
    invalidateUserInfo();

    track(TrackingEvents.AUTH.LOGOUT);
    if (redirectUrl) window.location.href = redirectUrl;
  });
}
