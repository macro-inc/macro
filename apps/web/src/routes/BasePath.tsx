import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { useCheckoutCompletionListener } from '@app/features/paywall/use-checkout-completion-listener';
import { clearLocalAuthSession } from '@core/auth/logout';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { hasLoginCookie } from '@core/util/cookies';
import { confirmSessionExpired } from '@core/util/fetchWithToken';
import { consumePostLoginRedirect } from '@core/util/postLoginRedirect';
import { thrownResultErrorHasCode } from '@core/util/result';
import {
  authKeys,
  invalidateUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { Navigate, useSearchParams } from '@solidjs/router';
import { Button } from '@ui';
import {
  createResource,
  createSignal,
  Match,
  onMount,
  Show,
  Switch,
} from 'solid-js';

export const OFFLINE_ROUTE = '/offline';

function getCurrentQueryString() {
  const params = new URLSearchParams(window.location.search);
  return params.toString().length > 0 ? `?${params.toString()}` : '';
}

function shouldShowNativeOfflineFallback(
  userInfoQuery: ReturnType<typeof useUserInfoQuery>
) {
  return (
    userInfoQuery.isError &&
    hasLoginCookie() &&
    isNativeMobilePlatform() &&
    !thrownResultErrorHasCode(userInfoQuery.error, 'UNAUTHORIZED')
  );
}

function OfflineFallback(props: { onRetry: () => Promise<unknown> }) {
  const [retrying, setRetrying] = createSignal(false);

  const handleRetry = async () => {
    setRetrying(true);
    await props.onRetry();
    setRetrying(false);
  };

  return (
    <div class="flex flex-col items-center justify-center gap-4 size-full text-ink-muted">
      <p class="text-sm">Unable to connect. Please check your network.</p>
      <Button
        class="mt-2"
        disabled={retrying()}
        onClick={handleRetry}
        variant="base"
      >
        {retrying() ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}

function SessionExpiredRedirect() {
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
      <Navigate href={`/welcome${getCurrentQueryString()}`} />
    </Show>
  );
}

export function OfflineFallbackRoute() {
  const userInfoQuery = useUserInfoQuery();

  // Once the query settles into anything other than a genuine connectivity
  // failure, bounce to the base path.
  return (
    <Switch fallback={<Navigate href={`/${getCurrentQueryString()}`} />}>
      <Match when={userInfoQuery.isLoading}>{null}</Match>
      <Match when={shouldShowNativeOfflineFallback(userInfoQuery)}>
        <OfflineFallback onRetry={() => userInfoQuery.refetch()} />
      </Match>
    </Switch>
  );
}

export function BasePathComponent() {
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const checkoutRefreshPending = useCheckoutCompletionListener();

  onMount(() => {
    if (searchParams.upgrade === 'true') {
      sessionStorage.setItem('showUpgradeModal', 'true');
    }
  });

  // check session storage for redirect url
  const redirectUrl = consumePostLoginRedirect();
  if (redirectUrl) {
    const relativeUrl = redirectUrl.replace(window.location.origin, '');
    window.location.href = relativeUrl;
    return;
  }

  // Preserve existing query parameters when redirecting
  const queryString = getCurrentQueryString();
  const redirectPath = `${DEFAULT_ROUTE}${queryString}`;

  return (
    <Switch>
      <Match when={userInfoQuery.isLoading || checkoutRefreshPending()}>
        {null}
      </Match>
      <Match
        when={
          hasLoginCookie() &&
          thrownResultErrorHasCode(userInfoQuery.error, 'UNAUTHORIZED')
        }
      >
        <SessionExpiredRedirect />
      </Match>
      <Match when={userInfoQuery.data?.authenticated}>
        <Navigate href={redirectPath} />
      </Match>
      <Match when={shouldShowNativeOfflineFallback(userInfoQuery)}>
        <Navigate href={`${OFFLINE_ROUTE}${queryString}`} />
      </Match>
      {/* Backstop: the user-info query sets networkMode 'always', so it never
          pauses on navigator.onLine (which misreports offline during native
          cold launches) and this state is currently unreachable. If that ever
          regresses, a paused query (isLoading false, no data) means "unknown",
          not "unauthenticated": wait for the fetch to resume rather than show
          login to a possibly-valid session. */}
      <Match when={userInfoQuery.fetchStatus === 'paused'}>{null}</Match>
      {/* An errored query on a cookie-backed session is also "unknown": a
          transient refresh or server failure is not proof the session is gone
          (a definitive UNAUTHORIZED is handled above). Keep the local session
          and wait for a retry instead of bouncing to login. */}
      <Match when={hasLoginCookie() && userInfoQuery.isError}>{null}</Match>
      <Match
        when={!userInfoQuery.isLoading && !userInfoQuery.data?.authenticated}
      >
        <Navigate href={`/welcome${queryString}`} />
      </Match>
    </Switch>
  );
}
