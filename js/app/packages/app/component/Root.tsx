import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import {
  UserContextProvider,
  useUserId,
  useUserInfo,
} from '@core/context/user';
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
import { transformShortIdInUrlPathname } from '@core/util/url';
import { MaybeTauriProvider } from '@macro/tauri';
import { Provider as EntityProvider } from '@macro-entity';
import {
  BrowserNotificationModal,
  createNotificationSource,
  type UnifiedNotification,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import { useObserveRouting } from '@observability';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { prefetchHistory } from '@queries/history/history';
import { invalidateUserNotifications } from '@queries/notification/user-notifications';
import { QuerySyncProvider } from '@queries/sync/SyncProvider';
import { MutationUndoProvider } from '@queries/undo';
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
import { useHotKeyRoot } from 'core/hotkey/hotkeys';
import { detect } from 'detect-browser';
import {
  createEffect,
  createSignal,
  type JSX,
  lazy,
  Match,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Suspense,
  Switch,
} from 'solid-js';
import { TauriRouteListener } from '../../tauri/src/TauriProvider';
import { currentThemeId } from '../../theme/signals/themeSignals';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  systemThemeEffect,
} from '../../theme/utils/themeUtils';
import { Login } from './auth/Login';
import { setCookie } from './auth/Shared';
import { Signup } from './auth/Signup';
import { makeEmailAuthComponents } from './EmailAuth';
import { GlobalAppStateProvider } from './GlobalAppState';
import { Layout } from './Layout';
import { SearchProvider } from './next-soup/search-context';
import { ReactiveFavicon } from './ReactiveFavicon';
import { LAYOUT_ROUTE } from './split-layout/SplitLayoutRoute';
import { TeamInviteAcceptance } from './TeamInviteAcceptance';

const NewOnboarding = lazy(() => import('./onboarding/onboarding'));
const OldOnboarding = lazy(
  () => import('./interactive-onboarding/InteractiveOnboarding')
);

import {
  AnalyticsContextProvider,
  useAnalytics,
} from '@app/component/analytics-context';
import {
  PosthogProvider,
  ShowFeatureFlag,
  usePosthog,
} from '@app/lib/analytics/posthog';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { ENABLE_NEW_ONBOARDING_OVERRIDE } from '@core/constant/featureFlags';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { Button } from '@ui';

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
  useObserveRouting();

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

function BasePathComponent() {
  const analytics = useAnalytics();

  const [searchParams] = useSearchParams();

  const subscriptionSuccess = searchParams.subscriptionSuccess;
  const type = searchParams.type;
  if (subscriptionSuccess === 'true') {
    toast.success('Your plan has been activated!');
    analytics.track('subscription_success', { type });
    // Invalidate user info to refresh trial status and subscription data
    invalidateUserInfo();
  }

  if (searchParams.subscriptionCancel === 'true') {
    analytics.track('subscription_cancel', { tier: searchParams.tier });
  }

  if (searchParams.upgrade === 'true') {
    sessionStorage.setItem('showUpgradeModal', 'true');
  }

  // check session storage for redirect url
  const redirectUrl = sessionStorage.getItem('redirectUrl');
  if (redirectUrl) {
    sessionStorage.removeItem('redirectUrl');
    const relativeUrl = redirectUrl.replace(window.location.origin, '');
    window.location.href = relativeUrl;
    return;
  }

  const userInfoQuery = useUserInfoQuery();

  // Preserve existing query parameters when redirecting
  const params = new URLSearchParams(window.location.search);
  const queryString =
    params.toString().length > 0 ? `?${params.toString()}` : '';
  const redirectPath = `${DEFAULT_ROUTE}${queryString}`;

  return (
    <Switch>
      <Match when={userInfoQuery.isLoading}>{null}</Match>
      <Match
        when={
          userInfoQuery.isError && hasLoginCookie() && isNativeMobilePlatform()
        }
      >
        <OfflineFallback onRetry={() => userInfoQuery.refetch()} />
      </Match>
      <Match
        when={!userInfoQuery.isLoading && !userInfoQuery.data?.authenticated}
      >
        <Navigate href={`/welcome${window.location.search}`} />
      </Match>
      <Match when={userInfoQuery.data?.authenticated}>
        <Navigate href={redirectPath} />
      </Match>
    </Switch>
  );
}

function NotFound() {
  if (isNativeMobilePlatform()) return <Navigate href={DEFAULT_ROUTE} />;
  window.location.href = window.location.origin;
  return '';
}

const { EmailCallback, CALLBACK_PATH } = makeEmailAuthComponents({
  callbackPath: '/email-signup-callback',
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
    path: '/welcome',
    component: () => (
      <div class="flex *:flex-1 size-full overflow-y-hidden">
        <ShowFeatureFlag
          key="enable-new-onboarding"
          enabledOverride={ENABLE_NEW_ONBOARDING_OVERRIDE}
          fallback={<OldOnboarding />}
        >
          <NewOnboarding />
        </ShowFeatureFlag>
      </div>
    ),
  },
  {
    path: '/team-invite',
    component: TeamInviteAcceptance,
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

  if (isNativeMobilePlatform()) {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        invalidateUserNotifications();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    onCleanup(() =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
    );
  }

  const blockOrchestrator = createBlockOrchestrator();

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

  let identified = false;
  createEffect(
    on(userInfo, (user) => {
      if (!user || !user.authenticated) return;

      if (posthog.instance._isIdentified() || identified) {
        return;
      }

      identified = true;

      const platform = detect(navigator.userAgent);
      const os = platform?.os?.replaceAll(' ', '');

      analytics.identify(user.id, {
        email: user.email,
        os,
      });
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
    systemThemeEffect();
    applyTheme(currentThemeId());
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
                <QuerySyncProviderWithUserId />
                <UserInfoSideEffects />
                <ConfiguredGlobalAppStateProvider>
                  <MutationUndoProvider>
                    <ChannelsContextProvider>
                      <CallProvider>
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
                            <ToastRegion />
                          </SearchProvider>
                        </QuickAccessProvider>
                      </CallProvider>
                    </ChannelsContextProvider>
                  </MutationUndoProvider>
                </ConfiguredGlobalAppStateProvider>
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
