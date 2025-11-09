import { withAnalytics } from '@coparse/analytics';
import { useAuthUserInfo } from '@core/auth';
import { useOrganization } from '@core/user';
import { authServiceClient } from '@service-auth/client';
import { gqlFetch, useUserInfo } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';

const { track, TrackingEvents } = withAnalytics();

export function useLogout() {
  const [, { mutate: mutateAuthUserInfo }] = useAuthUserInfo();
  const [, { mutate: mutateUserInfo }] = useUserInfo();
  const [, { mutate: mutateOrganization }] = useOrganization();

  return createCallback(async (redirectUrl?: string) => {
    document.cookie =
      'login=false; expires=Thu, 01 Jan 1970 00:00:00 UTC; max-age=0; path=/; SameSite=Lax';
    // Reset authenticated user permissions
    mutateAuthUserInfo(() => [
      null,
      {
        userId: undefined,
        authenticated: false,
        permissions: [],
        organizationId: undefined,
      },
    ]);

    // GQL reset
    mutateUserInfo(() => [
      null,
      {
        userId: undefined,
        authenticated: false,
        hasTrialed: false,
        group: undefined,
        hasChromeExt: false,
      },
    ]);
    mutateOrganization(() => ({
      organizationId: undefined,
      organizationName: undefined,
    }));

    // **DO NOT REMOVE**
    // Due to legacy auth and the fact we still use macro-gql we need to have this in our logout call.
    // This ensures we delete any legacy tokens that are in the browser.
    try {
      const query = `
      mutation logout {
        logout
      }
    `;
      await gqlFetch(query);
    } catch (_) {
      // We don't care if this fails though.
    }

    await authServiceClient.logout();

    track(TrackingEvents.AUTH.LOGOUT);
    if (redirectUrl) window.location.href = redirectUrl;
  });
}
