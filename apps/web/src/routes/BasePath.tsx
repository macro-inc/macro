import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { useCheckoutCompletionListener } from '@app/features/paywall/use-checkout-completion-listener';
import { prefetchChannelTarget } from '@channel/queries/prefetch-channel-target';
import {
  getCurrentQueryString,
  SessionExpiredRedirect,
} from '@components/app/SessionExpiredRedirect';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { hasLoginCookie } from '@core/util/cookies';
import { fireAndForget } from '@core/util/fireAndForget';
import { consumePostLoginRedirect } from '@core/util/postLoginRedirect';
import { thrownResultErrorHasCode } from '@core/util/result';
import { releaseNotificationCover } from '@macro/tauri/push-api';
import {
  notificationLaunchPath,
  pendingNotificationNavigation,
} from '@notifications/notification-navigation-intent';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { Navigate, useLocation, useSearchParams } from '@solidjs/router';
import { Button } from '@ui';
import {
  createEffect,
  createSignal,
  Match,
  on,
  onMount,
  Switch,
} from 'solid-js';

function shouldShowNativeSessionVerificationFallback(
  userInfoQuery: ReturnType<typeof useUserInfoQuery>
) {
  return (
    userInfoQuery.isError &&
    !userInfoQuery.data?.authenticated &&
    hasLoginCookie() &&
    isNativeMobilePlatform() &&
    !thrownResultErrorHasCode(userInfoQuery.error, 'UNAUTHORIZED')
  );
}

function SessionVerificationFallback(props: {
  onRetry: () => Promise<unknown>;
}) {
  onMount(() =>
    fireAndForget(releaseNotificationCover(), 'notification-launch')
  );
  const [retrying, setRetrying] = createSignal(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await props.onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div class="flex flex-col items-center justify-center gap-4 size-full text-ink-muted">
      <p class="text-sm">Unable to connect. Please check your network.</p>
      <Button
        class="mt-2"
        disabled={retrying()}
        onClick={handleRetry}
        variant="outline"
      >
        {retrying() ? 'Retrying…' : 'Retry'}
      </Button>
    </div>
  );
}

function AuthenticatedDestination(props: {
  fallback: string;
  recipientId: string;
}) {
  const pending = isNativeMobilePlatform() ? consumePostLoginRedirect() : null;
  const notificationPath = notificationLaunchPath(props.recipientId);
  const target = pendingNotificationNavigation()?.target;
  if (notificationPath && target) {
    fireAndForget(
      prefetchChannelTarget(target.channelId, {
        messageId: target.messageId,
        threadId: target.threadId ?? target.messageId,
      }),
      'notification-navigation'
    );
  }
  return <Navigate href={notificationPath ?? pending ?? props.fallback} />;
}

export function BasePathComponent() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const checkoutRefreshPending = useCheckoutCompletionListener();

  createEffect(
    on(
      () => searchParams.upgrade,
      (upgrade) => {
        if (upgrade === 'true')
          sessionStorage.setItem('showUpgradeModal', 'true');
      }
    )
  );

  // check session storage for redirect url
  // Native destinations survive process death and must remain pending until
  // identity is known; consuming during the unauthenticated launch loses them.
  const redirectUrl = isNativeMobilePlatform()
    ? null
    : consumePostLoginRedirect();
  if (redirectUrl) {
    const relativeUrl = redirectUrl.replace(window.location.origin, '');
    window.location.href = relativeUrl;
    return;
  }

  // Preserve existing query parameters when redirecting
  const queryString = () => getCurrentQueryString(location.search);
  const redirectPath = () => `${DEFAULT_ROUTE}${queryString()}`;

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
        <AuthenticatedDestination
          fallback={redirectPath()}
          recipientId={userInfoQuery.data!.userId}
        />
      </Match>
      {/* A failed remote check does not make an authenticated cached session
          unusable: the data branch above enters the local app first. Block only
          when native has a login marker but no locally verifiable identity. */}
      <Match when={shouldShowNativeSessionVerificationFallback(userInfoQuery)}>
        <SessionVerificationFallback onRetry={() => userInfoQuery.refetch()} />
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
        <Navigate href={`/welcome${queryString()}`} />
      </Match>
    </Switch>
  );
}
