import { clearLocalAuthSession } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { confirmSessionExpired } from '@core/util/fetchWithToken';
import { thrownResultErrorHasCode } from '@core/util/result';
import { authKeys, invalidateUserInfo } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { Navigate, useLocation } from '@solidjs/router';
import { createResource, Show } from 'solid-js';

export function getCurrentQueryString(routerSearch: string) {
  const params = new URLSearchParams(
    isNativeMobilePlatform() ? routerSearch : window.location.search
  );
  return params.toString().length > 0 ? `?${params.toString()}` : '';
}

/**
 * Sends a session the server rejected to /welcome, after confirming it with a
 * fresh refresh; the base path and the app chrome render it on a stale login.
 */
export function SessionExpiredRedirect() {
  const location = useLocation();
  // The UNAUTHORIZED that got us here can come from a latched refresh failure
  // without the server ever being consulted, so confirm with a fresh refresh
  // before destroying local session state. If the session turns out to be
  // alive, refetch user-info instead and only treat a repeat 401 as real.
  const [expired] = createResource(async () => {
    if (!(await confirmSessionExpired())) {
      await invalidateUserInfo();
      const stillUnauthorized = thrownResultErrorHasCode(
        queryClient.getQueryState(authKeys.userInfo.queryKey)?.error,
        'UNAUTHORIZED'
      );
      if (!stillUnauthorized) return false;
    }
    await clearLocalAuthSession().catch((error) => {
      console.error('Failed to clear local auth session', error);
    });
    return true;
  });

  return (
    <Show when={expired()}>
      <Navigate href={`/welcome${getCurrentQueryString(location.search)}`} />
    </Show>
  );
}
