import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { useEmailLinksStatus } from '@app/signal/emailAuth';
import { withAnalytics } from '@coparse/analytics';
import { useIsAuthenticated } from '@core/auth';
import { ChannelsContextProvider } from '@core/component/ChannelsProvider';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { WebsocketDebugger } from '@core/component/WebsocketDebugger';
import {
  ENABLE_WEBSOCKET_DEBUGGER,
  PROD_MODE_ENV,
} from '@core/constant/featureFlags';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isErr } from '@core/util/maybeResult';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { isTauri, isTauriPlatform, MaybeTauriProvider } from '@macro/tauri';
import { createEmailSource, Provider as EntityProvider } from '@macro-entity';
import {
  createNotificationSource,
  usePlatformNotificationState,
} from '@notifications';
import { setUser, useObserveRouting } from '@observability';
import { ws as connectionGatewayWebsocket } from '@service-connection/websocket';
import { gqlServiceClient } from '@service-gql/client';
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
  lazy,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { currentThemeId } from '../../block-theme/signals/themeSignals';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  systemThemeEffect,
} from '../../block-theme/utils/themeUtils';
import { TauriRouteListener } from '../../tauri/src/TauriProvider';
import { useSoundHover } from '../util/soundHover';
import { updateCookie } from '../util/updateCookie';
import { Login } from './auth/Login';
import { LOGIN_COOKIE_AGE, setCookie } from './auth/Shared';
import { GlobalAppStateProvider } from './GlobalAppState';
import { Layout } from './Layout';
import MacroJump from './MacroJump';
import Onboarding from './Onboarding';
import { LAYOUT_ROUTE } from './split-layout/SplitLayoutRoute';

const { track, identify, TrackingEvents } = withAnalytics();

const rootPreload: RoutePreloadFunc = async (args) => {
  useObserveRouting();

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
  // TODO: load general data like sidepanel, etc.
  const userInfoResult = await gqlServiceClient.getUserInfo();
  if (isErr(userInfoResult)) return;

  const [, { id, email, hasChromeExt, ...userInfo }] = userInfoResult;
  const platform = detect(navigator.userAgent);
  const os = `${platform?.os?.replaceAll(' ', '')}`;

  if (id) {
    if (email) {
      setUser({
        ...userInfo,
        id,
        email,
        hasChromeExt,
        // ...utmObj,
      });
    }

    if (PROD_MODE_ENV) {
      identify(id, { email, os, hasChromeExt });
    }
  }
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

  const authenticated = useIsAuthenticated();
  if (!authenticated()) return <Navigate href="/onboarding" />;

  // Preserve existing query parameters when redirecting
  const params = new URLSearchParams(window.location.search);
  const queryString =
    params.toString().length > 0 ? `?${params.toString()}` : '';

  const redirectPath = `${DEFAULT_ROUTE}${queryString}`;

  return <Navigate href={redirectPath} />;
}

function NotFound() {
  if (isNativeMobilePlatform()) return <Navigate href={DEFAULT_ROUTE} />;
  window.location.href = window.location.origin;
  return '';
}

const ROUTES: RouteDefinition[] = [
  LAYOUT_ROUTE,
  {
    path: '/',
    component: BasePathComponent,
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
            <TextButton
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
    component: () => (
      <div class="flex w-full h-full overflow-y-hidden">
        <Login />
      </div>
    ),
  },
  {
    path: '/onboarding',
    component: () => (
      <div class="flex *:flex-1 w-full h-full overflow-y-hidden">
        <Onboarding />
      </div>
    ),
  },
  {
    path: '/new/:block',
    component: lazy(() => import('./NewRoute')),
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
  const notificationSource = createNotificationSource(
    connectionGatewayWebsocket,
    notifInterface === 'not-supported'
      ? undefined
      : notifInterface.showNotification
  );

  const emailActive = useEmailLinksStatus();
  const emailSource = createEmailSource(undefined, undefined, {
    disabled: () => !emailActive(),
  });

  const blockOrchestrator = createBlockOrchestrator();

  return (
    <GlobalAppStateProvider
      notificationSource={notificationSource}
      emailSource={emailSource}
      blockOrchestrator={blockOrchestrator}
    >
      {props.children}
    </GlobalAppStateProvider>
  );
}

const clearBodyInlineStyleColor = () => {
  // index.html has inline script to set page color to theme surface to prevent page color flash.
  // removes page color inline style to prevent overriding main stylesheet
  document.body.style.backgroundColor = '';
};

export function Root() {
  const isAuthenticated = useIsAuthenticated();
  useHotKeyRoot();
  useSoundHover();

  clearBodyInlineStyleColor();

  createEffect(() => {
    const isAuth = isAuthenticated();

    if (isAuth) {
      const currentDate = new Date();
      const oneMonthFromNow = new Date(
        currentDate.setMonth(currentDate.getMonth() + 1)
      );

      updateCookie('login', 'true', {
        expires: oneMonthFromNow,
        maxAge: LOGIN_COOKIE_AGE,
        path: '/',
        sameSite: 'Lax',
      });
    } else {
      updateCookie('login', 'false', {
        expires: new Date(0),
        maxAge: 0,
        path: '/',
        sameSite: 'Lax',
      });
    }
  });

  createEffect(() => {
    const cleanup = licenseChannel.subscribe(() => {
      gqlServiceClient.getUserInfo.invalidate();
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
  const routerBase = isTauriPlatform() ? '/' : '/app';

  return (
    <MaybeTauriProvider>
      <MetaProvider>
        <EntityProvider>
          <ConfiguredGlobalAppStateProvider>
            <ChannelsContextProvider>
              <Title>{tabTitle()}</Title>
              <MacroJump />
              <Suspense fallback={''}>
                <IsomorphicRouter
                  transformUrl={transformShortIdInUrlPathname}
                  root={Layout}
                  rootPreload={rootPreload}
                  base={routerBase}
                >
                  {{
                    path: '/',
                    component: TauriRouteListener,
                    children: ROUTES,
                  }}
                </IsomorphicRouter>
              </Suspense>
              <ToastRegion />
              <Show when={ENABLE_WEBSOCKET_DEBUGGER}>
                <WebsocketDebugger />
              </Show>
            </ChannelsContextProvider>
          </ConfiguredGlobalAppStateProvider>
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
