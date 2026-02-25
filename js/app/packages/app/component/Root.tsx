import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { withAnalytics } from '@coparse/analytics';
import { TabAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { DeprecatedTextButton } from '@core/component/DeprecatedTextButton';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { PROD_MODE_ENV } from '@core/constant/featureFlags';
import { ChannelsContextProvider } from '@core/context/channels';
import { UserContextProvider, useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import { getLoginCookieOptions, updateCookie } from '@core/util/cookies';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { MaybeTauriProvider } from '@macro/tauri';
import { Provider as EntityProvider } from '@macro-entity';
import {
  createNotificationSource,
  type UnifiedNotification,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import { setUser, useObserveRouting } from '@observability';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { prefetchHistory } from '@queries/history/history';
import { invalidateUserNotifications } from '@queries/notification/user-notifications';
import { QuerySyncProvider } from '@queries/sync/SyncProvider';
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
  type JSX,
  Match,
  onCleanup,
  onMount,
  type ParentProps,
  Switch,
} from 'solid-js';
import { currentThemeId } from '../../block-theme/signals/themeSignals';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  systemThemeEffect,
} from '../../block-theme/utils/themeUtils';
import { TauriRouteListener } from '../../tauri/src/TauriProvider';
import { Login } from './auth/Login';
import { setCookie } from './auth/Shared';
import { makeEmailAuthComponents } from './EmailAuth';
import { GlobalAppStateProvider } from './GlobalAppState';
import { SearchProvider } from './next-soup/search-context';
import { Layout } from './Layout';
import MacroJump from './MacroJump';
import Onboarding from './Onboarding';
import { ReactiveFavicon } from './ReactiveFavicon';
import { SuspenseContextComp } from './SuspenseContext';
import { LAYOUT_ROUTE } from './split-layout/SplitLayoutRoute';
import Visor from './Visor';
import { QuickAccessProvider } from '@core/context/quickAccess';

const { track, identify, TrackingEvents } = withAnalytics();

/** Syncs login cookie with auth state. Only updates on successful query (not errors/loading). */
function useSyncLoginCookie() {
  const userInfoQuery = useUserInfoQuery();

  createEffect(() => {
    if (!userInfoQuery.isSuccess) return;

    const { value, ...options } = getLoginCookieOptions(
      userInfoQuery.data.authenticated ?? false
    );
    updateCookie('login', value, options);
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

  track(TrackingEvents.AUTH.START);
};

function BasePathComponent() {
  const [searchParams] = useSearchParams();
  const subscriptionSuccess = searchParams.subscriptionSuccess;
  const type = searchParams.type;
  if (subscriptionSuccess === 'true') {
    toast.success('Your plan has been activated!');
    track(TrackingEvents.SUBSCRIPTION.SUCCESS, {
      type: type ?? undefined,
    });
    // Invalidate user info to refresh trial status and subscription data
    invalidateUserInfo();
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
        when={!userInfoQuery.isLoading && !userInfoQuery.data?.authenticated}
      >
        <Navigate href={isNativeMobilePlatform() ? '/login' : '/signup'} />
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

const { EmailSignUp, EmailCallback, CALLBACK_PATH } = makeEmailAuthComponents({
  callbackPath: '/email-signup-callback',
  successPath: '/',
});

const ROUTES: RouteDefinition[] = [
  LAYOUT_ROUTE,
  {
    path: '/',
    component: BasePathComponent,
  },
  {
    path: '/signup',
    component: EmailSignUp,
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
            <DeprecatedTextButton
              theme="base"
              text="Close"
              onClick={() => {
                channel.postMessage({ type: 'login-success' });
                channel.close();
                window.close();
              }}
            />
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
    path: '/onboarding',
    component: () => (
      <div class="flex *:flex-1 w-full h-dvh overflow-y-hidden">
        <Onboarding />
      </div>
    ),
  },
  {
    // This splat route must be last to catch all unmatched routes
    path: '*404',
    component: NotFound,
  },
];

export function ConfiguredGlobalAppStateProvider(props: ParentProps) {
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
  useSyncLoginCookie();

  // Set user info for observability and analytics
  const userInfoQuery = useUserInfoQuery();
  createEffect(() => {
    if (userInfoQuery.isLoading) return;
    const data = userInfoQuery.data;
    if (!data?.id) return;

    const platform = detect(navigator.userAgent);
    const os = platform?.os?.replaceAll(' ', '') ?? '';

    setUser({
      id: data.id,
      email: data.email,
      hasChromeExt: data.hasChromeExt,
    });

    if (PROD_MODE_ENV) {
      identify(data.id, {
        email: data.email,
        os,
        hasChromeExt: data.hasChromeExt,
      });
    }
  });

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

  const handleBeforeUnload = () => track(TrackingEvents.AUTH.TERMINATE);
  onMount(() => {
    systemThemeEffect();
    applyTheme(currentThemeId());
    ensureMinimalThemeContrast();
    window.addEventListener('beforeunload', handleBeforeUnload);
  });
  onCleanup(() =>
    window.removeEventListener('beforeunload', handleBeforeUnload)
  );

  const [tabInfo] = tabTitleSignal;
  const tabTitle = () => formatTabTitle(tabInfo());

  let runRootWarningLog = false;
  const RootSuspenseFallback = () => {
    const runWarningLog = () => {
      if (!runRootWarningLog) {
        setTimeout(() => {
          runRootWarningLog = true;
        });
        return;
      }

      console.warn('Root Suspsense Triggered');
    };

    runWarningLog();

    return '';
  };

  return (
    <MaybeTauriProvider>
      <MetaProvider>
        <EntityProvider>
          <UserContextProvider>
            <QuerySyncProviderWithUserId />
            <UserInfoSideEffects />
            <ConfiguredGlobalAppStateProvider>
              <ChannelsContextProvider>
                <QuickAccessProvider>
                  <SearchProvider>
                    <TabAttachmentsInit />
                    <ReactiveFavicon />
                    <Title>{tabTitle()}</Title>
                    <MacroJump />
                    <Visor />
                    <SuspenseContextComp fallback={<RootSuspenseFallback />}>
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
                    </SuspenseContextComp>
                    <ToastRegion />
                  </SearchProvider>
                </QuickAccessProvider>
              </ChannelsContextProvider>
            </ConfiguredGlobalAppStateProvider>
          </UserContextProvider>
        </EntityProvider>
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
