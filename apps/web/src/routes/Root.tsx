import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import { Login } from '@app/features/auth/Login';
import { MobileAuthWelcome } from '@app/features/auth/mobile-onboarding/MobileAuthWelcome';
import { MobileOnboarding } from '@app/features/auth/mobile-onboarding/MobileOnboarding';
import { setCookie } from '@app/features/auth/Shared';
import { Signup } from '@app/features/auth/Signup';
import { ChannelInviteAcceptance } from '@app/features/channel-invitations/ChannelInviteAcceptance';
import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { SearchProvider } from '@app/features/next-soup/search-context';
import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { InteractiveOnboardingModal } from '@app/features/onboarding/InteractiveOnboardingModal';
import { useCheckoutCompletionListener } from '@app/features/paywall/use-checkout-completion-listener';
import { TeamInviteAcceptance } from '@app/features/team-invitations/TeamInviteAcceptance';
import {
  AnalyticsContextProvider,
  useAnalytics,
} from '@app/lib/analytics/analytics-context';
import { PosthogProvider, usePosthog } from '@app/lib/analytics/posthog';
import { trackSignupCompletion } from '@app/lib/analytics/signupCompletion';
import { useInvalidateQueriesOnReconnect } from '@app/lib/queries/invalidate-on-reconnect';
import { useSoupBackfills } from '@app/lib/queries/soup/backfill';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { CallKitSync } from '@channel/Call/use-callkit';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { Layout } from '@components/app/Layout';
import { ReactiveFavicon } from '@components/app/ReactiveFavicon';
import { LAYOUT_ROUTE } from '@components/app/split-layout/SplitLayoutRoute';
import { clearLocalAuthSession } from '@core/auth/logout';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { TeamContextProvider } from '@core/context/team';
import {
  UserContextProvider,
  useUserId,
  useUserInfo,
} from '@core/context/user';
import { initAndStartEmailSync } from '@core/email-link';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { IosPushNotificationModal } from '@core/mobile/IosPushNotificationModal';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import {
  getLoginCookieOptions,
  hasLoginCookie,
  syncLoginStorage,
  updateCookie,
} from '@core/util/cookies';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isTauri } from '@core/util/platform';
import { thrownResultErrorHasCode } from '@core/util/result';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { EntityProvider } from '@entity';
import { MaybeTauriProvider } from '@macro/tauri';
import { TauriRouteListener } from '@macro/tauri/TauriProvider';
import {
  BrowserNotificationModal,
  createNotificationSource,
  type UnifiedNotification,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import {
  clearUser as clearDatadogUser,
  setUser as setDatadogUser,
} from '@observability';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { useChatRenameWebsocketSync } from '@queries/chat';
import { prefetchHistory } from '@queries/history/history';
import { QuerySyncProvider } from '@queries/sync/SyncProvider';
import { MutationUndoProvider } from '@queries/undo';
import { useReopenTrackedEntitiesOnReconnect } from '@service-connection/client';
import { ws as connectionGatewayWebsocket } from '@service-connection/websocket';
import { MetaProvider, Title } from '@solidjs/meta';
import {
  HashRouter,
  Navigate,
  type RouteDefinition,
  type RoutePreloadFunc,
  Router,
  type RouterProps,
  useSearchParams,
} from '@solidjs/router';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  resolveActiveThemeId,
  systemThemeEffect,
} from '@theme/utils/themeUtils';
import { Button } from '@ui';
import { detect } from 'detect-browser';
import {
  createEffect,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Suspense,
  Switch,
} from 'solid-js';

/** Syncs login cookie with auth state. Only updates on successful query (not errors/loading). */
function useSyncLoginCookie() {
  const userInfoQuery = useUserInfoQuery();

  createEffect(() => {
    if (!userInfoQuery.isSuccess) return;

    const authenticated = userInfoQuery.data.authenticated ?? false;
    const { value, ...options } = getLoginCookieOptions(authenticated);
    updateCookie('login', value, options);
    syncLoginStorage(authenticated);
  });
}

const rootPreload: RoutePreloadFunc = async (args) => {
  await prefetchUserInfo();
  prefetchHistory();

  // even though we are using the transformUrl prop, we may still need to replace the url in the history
  const url = new URL(window.location.href);

  // List of query parameters to capture.
  const params = [
    'utm_campaign',
    'utm_source',
    'utm_medium',
    'utm_term',
    'utm_content',
    'rdt_cid',
    'fbclid',
    'gclid',
    'twclid',
    '_fbc',
    '_fbp',
  ];

  const searchParams = new URLSearchParams(url.search);
  params.forEach((param) => {
    const value = searchParams.get(param);
    if (value) {
      setCookie(param, value, 1); // Set the cookie to expire in 1 day.
    }
  });

  const existingPathname = url.pathname;
  const transformedPathname = transformShortIdInUrlPathname(existingPathname);
  if (existingPathname !== transformedPathname) {
    console.warn(
      `replacing url pathname from ${existingPathname} to ${transformedPathname}`
    );
    url.pathname = transformedPathname;
    window.history.replaceState(args.location.state, '', url);
  }
};

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

const OFFLINE_ROUTE = '/offline';

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

function SessionExpiredRedirect() {
  void clearLocalAuthSession().catch((error) => {
    console.error('Failed to clear local auth session', error);
  });
  return <Navigate href={`/welcome${getCurrentQueryString()}`} />;
}

function OfflineFallbackRoute() {
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

function BasePathComponent() {
  const [searchParams] = useSearchParams();
  const userInfoQuery = useUserInfoQuery();
  const checkoutRefreshPending = useCheckoutCompletionListener();

  onMount(() => {
    if (searchParams.upgrade === 'true') {
      sessionStorage.setItem('showUpgradeModal', 'true');
    }
  });

  // check session storage for redirect url
  const redirectUrl = sessionStorage.getItem('redirectUrl');
  if (redirectUrl) {
    sessionStorage.removeItem('redirectUrl');
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
      <Match
        when={!userInfoQuery.isLoading && !userInfoQuery.data?.authenticated}
      >
        <Navigate href={`/welcome${queryString}`} />
      </Match>
    </Switch>
  );
}

function NotFound() {
  if (isNativeMobilePlatform()) return <Navigate href={DEFAULT_ROUTE} />;
  window.location.href = window.location.origin;
  return '';
}

const { EmailCallback, CALLBACK_PATH, EmailLinkCallback, LINK_CALLBACK_PATH } =
  makeEmailAuthComponents({
    callbackPath: '/email-signup-callback',
    linkCallbackPath: '/inbox-link-callback',
    successPath: '/',
  });

const ROUTES: RouteDefinition[] = [
  LAYOUT_ROUTE,
  /** BEGIN - APP ROUTES */
  {
    path: '/inbox',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/activity',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/agents',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/mail',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/documents',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/tasks',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/channels',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/calls',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/companies',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/files',
    component: LAYOUT_ROUTE.component,
  },
  /** END - APP ROUTES */

  {
    path: '/',
    component: BasePathComponent,
  },
  {
    path: '/signup',
    component: Signup,
  },
  {
    path: CALLBACK_PATH,
    component: EmailCallback,
  },
  {
    path: LINK_CALLBACK_PATH,
    component: EmailLinkCallback,
  },
  {
    path: '/login/popup/success',
    component: () => {
      const channel = new BroadcastChannel('auth');

      onMount(() => {
        channel.postMessage({ type: 'login-success' });
        channel.close();
        window.close();
      });

      onCleanup(() => {
        channel.close();
        window.close();
      });

      return (
        <div class="h-full overflow-y-hidden">
          <div class="relative flex flex-row items-center pt-4 h-full">
            <Button
              variant="base"
              onClick={() => {
                channel.postMessage({ type: 'login-success' });
                channel.close();
                window.close();
              }}
            >
              Close
            </Button>
          </div>
        </div>
      );
    },
  },
  {
    path: '/login',
    component: () => <Login />,
  },
  {
    path: OFFLINE_ROUTE,
    component: OfflineFallbackRoute,
  },
  {
    path: '/welcome',
    component: () =>
      isNativeMobilePlatform() ? (
        <MobileAuthWelcome />
      ) : (
        <Navigate href="/login" />
      ),
  },
  {
    path: '/onboarding',
    component: () =>
      isNativeMobilePlatform() ? (
        <MobileOnboarding />
      ) : (
        <Navigate href="/login" />
      ),
  },
  {
    path: '/team-invite',
    component: TeamInviteAcceptance,
  },
  {
    path: '/channel-invite',
    component: ChannelInviteAcceptance,
  },
  {
    // This splat route must be last to catch all unmatched routes
    path: '*404',
    component: NotFound,
  },
];

function ConfiguredGlobalAppStateProvider(props: ParentProps) {
  // Initialize global notification helpers
  const notifInterface = usePlatformNotificationState();
  useChatRenameWebsocketSync();
  useReopenTrackedEntitiesOnReconnect();

  if (isNativeMobilePlatform()) {
    useInvalidateQueriesOnReconnect();
  }

  const onNotification = (notification: UnifiedNotification) => {
    if (notifInterface === 'not-supported') return;
    const layoutManager = globalSplitManager();
    if (!layoutManager) return;
    maybeHandlePlatformNotification(
      notification,
      notifInterface,
      layoutManager
    );
  };
  const notificationSource = createNotificationSource(
    connectionGatewayWebsocket,
    onNotification
  );

  const blockOrchestrator = createBlockOrchestrator();
  usePendingNotificationNavigationEffect(notificationSource);

  return (
    <GlobalAppStateProvider
      notificationSource={notificationSource}
      blockOrchestrator={blockOrchestrator}
    >
      {props.children}
    </GlobalAppStateProvider>
  );
}

/** Sets user info for observability, analytics, and login cookie. Must be inside QueryClientProvider. */
function UserInfoSideEffects() {
  const analytics = useAnalytics();
  const posthog = usePosthog();

  useSyncLoginCookie();

  // Set user info for observability and analytics
  const userInfo = useUserInfo();

  useSoupBackfills(() => userInfo()?.id);

  // Keep the active theme following the OS color scheme when auto-detect is on.
  systemThemeEffect();

  let identified = false;
  createEffect(
    on(userInfo, (user) => {
      // Keep Datadog log user context in sync with auth state: set on every
      // authenticated load (the logs SDK doesn't persist across reloads), and
      // clear on logout so logs aren't attributed to a signed-out user. Logout
      // flips userInfo client-side, and on native mobile it's an SPA navigation
      // with no page reload, so this effect is what clears it there.
      if (user?.authenticated) {
        setDatadogUser({ id: user.id, email: user.email });
      } else {
        clearDatadogUser();
      }

      if (!user || !user.authenticated) return;

      if (!posthog.instance._isIdentified() && !identified) {
        identified = true;

        const platform = detect(navigator.userAgent);
        const os = platform?.os?.replaceAll(' ', '');

        analytics.identify(user.id, {
          email: user.email,
          os,
        });
      }

      // Fires sign_up + ad conversions once when the auth service flagged this
      // session as a freshly created account (signed_up=true redirect param).
      trackSignupCompletion(analytics, { id: user.id });
    })
  );

  return null;
}

const clearBodyInlineStyleColor = () => {
  // index.html has inline script to set page color to theme surface to prevent page color flash.
  // removes page color inline style to prevent overriding main stylesheet
  document.body.style.backgroundColor = '';
};

function QuerySyncProviderWithUserId() {
  const userId = useUserId();
  return <QuerySyncProvider userId={userId} />;
}

function InitialInteractiveOnboardingModal() {
  const userInfoQuery = useUserInfoQuery();
  const [open, setOpen] = createSignal(true);
  const [onboardingStarted, setOnboardingStarted] = createSignal(false);

  const modalOpen = () =>
    open() &&
    !isNativeMobilePlatform() &&
    userInfoQuery.data?.authenticated === true &&
    (userInfoQuery.data.tutorialComplete === false || onboardingStarted());

  createEffect(() => {
    if (modalOpen()) {
      setOnboardingStarted(true);
    }
  });

  // First-time users (tutorial not yet completed) reach the app without passing
  // through a login route that inits the email link — e.g. marketing SSO returns to
  // /app, not /login — so kick off email sync once here. Idempotent on the backend;
  // AlreadyInitialized is ignored. Keyed by user id (not a bare flag) so a native
  // mobile logout→login of a different user in the same session still inits.
  let emailInitForUserId: string | undefined;
  createEffect(() => {
    const data = userInfoQuery.data;
    if (data?.authenticated !== true || data.tutorialComplete !== false) return;
    if (emailInitForUserId === data.id) return;
    emailInitForUserId = data.id;

    void initAndStartEmailSync().match(
      () => {},
      (err) => {
        if (err.tag !== 'AlreadyInitialized') {
          console.error('Failed to init email link for new user', err);
        }
      }
    );
  });

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setOnboardingStarted(false);
    }
  };

  return (
    <InteractiveOnboardingModal
      open={modalOpen()}
      isFirstTimeOnboarding
      onOpenChange={handleOpenChange}
    />
  );
}

export function Root() {
  setHotkeyRoot(useHotKeyRoot());

  clearBodyInlineStyleColor();

  createEffect(() => {
    const cleanup = licenseChannel.subscribe(() => {
      invalidateUserInfo();
    });

    onCleanup(() => cleanup());
  });

  onMount(() => {
    applyTheme(resolveActiveThemeId());
    ensureMinimalThemeContrast();
  });

  const [tabInfo] = tabTitleSignal;
  const tabTitle = () => formatTabTitle(tabInfo());

  return (
    <MaybeTauriProvider>
      <MetaProvider>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <EntityProvider>
              <UserContextProvider>
                <BrowserNotificationModal />
                <IosPushNotificationModal />
                <GlobalShareInboxConflictDialog />
                <QuerySyncProviderWithUserId />
                <UserInfoSideEffects />
                <TeamContextProvider>
                  <ConfiguredGlobalAppStateProvider>
                    <MutationUndoProvider>
                      <ChannelsContextProvider>
                        <CallProvider>
                          <CallKitSync />
                          <CallStartedNotifier />
                          <QuickAccessProvider>
                            <SearchProvider>
                              <ChatAttachmentsInit />
                              <ReactiveFavicon />
                              <Title>{tabTitle()}</Title>
                              <Suspense>
                                <IsomorphicRouter
                                  transformUrl={transformShortIdInUrlPathname}
                                  root={Layout}
                                  rootPreload={rootPreload}
                                  base={ROUTER_BASE}
                                >
                                  {{
                                    path: '/',
                                    component: TauriRouteListener,
                                    children: ROUTES,
                                  }}
                                </IsomorphicRouter>
                              </Suspense>
                              <InitialInteractiveOnboardingModal />
                              <ToastRegion />
                            </SearchProvider>
                          </QuickAccessProvider>
                        </CallProvider>
                      </ChannelsContextProvider>
                    </MutationUndoProvider>
                  </ConfiguredGlobalAppStateProvider>
                </TeamContextProvider>
              </UserContextProvider>
            </EntityProvider>
          </PosthogProvider>
        </AnalyticsContextProvider>
      </MetaProvider>
    </MaybeTauriProvider>
  );
}

// A router component that correctly handles both the web and tauri routing
function IsomorphicRouter(props: RouterProps): JSX.Element {
  if (isTauri()) {
    return <HashRouter {...props} />;
  }
  return <Router {...props} />;
}
