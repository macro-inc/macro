import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { setCookie } from '@app/features/auth/Shared';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import {
  AnalyticsContextProvider,
  useAnalytics,
} from '@app/lib/analytics/analytics-context';
import { PosthogProvider, usePosthog } from '@app/lib/analytics/posthog';
import { trackSignupCompletion } from '@app/lib/analytics/signupCompletion';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { Layout } from '@components/app/Layout';
import { LAYOUT_ROUTE } from '@components/app/split-layout/SplitLayoutRoute';
import { publishLoginSuccess } from '@core/auth/login-events';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import {
  UserContextProvider,
  useIsAuthenticated,
  useUserInfo,
} from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import {
  getLoginCookieOptions,
  hasLoginCookie,
  syncLoginStorage,
  updateCookie,
} from '@core/util/cookies';
import { devPerfLog } from '@core/util/devPerf';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { EntityProvider } from '@entity';
import {
  MaybeTauriProvider,
  TauriRouteListener,
} from '@macro/tauri/MaybeTauriProvider';
import { Telemetry } from '@macro-inc/observability';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { MetaProvider, Title } from '@solidjs/meta';
import {
  HashRouter,
  Navigate,
  type RouteDefinition,
  type RoutePreloadFunc,
  Router,
  type RouterProps,
  useLocation,
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
  type JSX,
  lazy,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';

const BasePathComponent = lazy(() =>
  import('./BasePath').then((module) => ({
    default: module.BasePathComponent,
  }))
);

const Login = lazy(() =>
  import('@app/features/auth/Login').then((module) => ({
    default: module.Login,
  }))
);
const MobileAuthWelcome = lazy(() =>
  import('@app/features/auth/mobile-onboarding/MobileAuthWelcome').then(
    (module) => ({ default: module.MobileAuthWelcome })
  )
);
const MobileOnboarding = lazy(() =>
  import('@app/features/auth/mobile-onboarding/MobileOnboarding').then(
    (module) => ({ default: module.MobileOnboarding })
  )
);
const ChannelInviteAcceptance = lazy(() =>
  import('@app/features/channel-invitations/ChannelInviteAcceptance').then(
    (module) => ({ default: module.ChannelInviteAcceptance })
  )
);
const MobileWebSignup = lazy(
  () => import('@app/features/onboarding/MobileWebSignup')
);
const OnboardingFlow = lazy(() =>
  import('@app/features/setup/flow/OnboardingFlow').then((module) => ({
    default: module.OnboardingFlow,
  }))
);
const TeamInviteAcceptance = lazy(() =>
  import('@app/features/team-invitations/TeamInviteAcceptance').then(
    (module) => ({ default: module.TeamInviteAcceptance })
  )
);
const TaskRoute = lazy(() =>
  import('./TaskRoute').then((module) => ({ default: module.TaskRoute }))
);
const WorkspaceProviders = lazy(() => {
  const started =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  // #region agent log
  devPerfLog('D', 'Root.tsx:117', 'workspace providers import start', {
    pathname: typeof window !== 'undefined' ? window.location.pathname : '',
  });
  // #endregion
  return import('./WorkspaceProviders').then((module) => {
    // #region agent log
    devPerfLog('D', 'Root.tsx:123', 'workspace providers import resolved', {
      pathname: typeof window !== 'undefined' ? window.location.pathname : '',
      elapsedMs:
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        started,
    });
    // #endregion
    return module;
  });
});

const EMAIL_CALLBACK_PATH = '/email-signup-callback';
const EMAIL_LINK_CALLBACK_PATH = '/inbox-link-callback';
const EmailCallback = lazy(() =>
  import('@app/features/auth/EmailAuth').then((module) => {
    const { EmailCallback: Callback } = module.makeEmailAuthComponents({
      callbackPath: EMAIL_CALLBACK_PATH,
      linkCallbackPath: EMAIL_LINK_CALLBACK_PATH,
      successPath: '/',
    });
    return { default: Callback };
  })
);
const EmailLinkCallback = lazy(() =>
  import('@app/features/auth/EmailAuth').then((module) => {
    const { EmailLinkCallback: Callback } = module.makeEmailAuthComponents({
      callbackPath: EMAIL_CALLBACK_PATH,
      linkCallbackPath: EMAIL_LINK_CALLBACK_PATH,
      successPath: '/',
    });
    return { default: Callback };
  })
);

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
  const started =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const loginCookie = hasLoginCookie();
  // #region agent log
  devPerfLog('A', 'Root.tsx:176', 'root preload start', {
    pathname: window.location.pathname,
    nextPathname: args.location.pathname,
    hasLoginCookie: loginCookie,
  });
  // #endregion
  if (loginCookie) {
    const prefetchStarted =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    void prefetchUserInfo().finally(() => {
      // #region agent log
      devPerfLog('A', 'Root.tsx:189', 'prefetchUserInfo settled', {
        pathname: window.location.pathname,
        elapsedMs:
          (typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()) - prefetchStarted,
      });
      // #endregion
    });
  }

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
  // #region agent log
  devPerfLog('A', 'Root.tsx:214', 'root preload end', {
    pathname: window.location.pathname,
    elapsedMs:
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
      started,
    hasLoginCookie: loginCookie,
  });
  // #endregion
};

function NotFound() {
  if (isNativeMobilePlatform()) return <Navigate href={DEFAULT_ROUTE} />;
  window.location.href = window.location.origin;
  return '';
}

/** The retired /setup path forwards to the onboarding flow, query intact. */
function SetupRedirect() {
  const location = useLocation();
  return <Navigate href={`/onboarding${location.search}`} />;
}

/**
 * The old split-screen /setup surface is retired; the onboarding flow lives at
 * /onboarding now. Flag off, /setup must go home — forwarding would land
 * flag-off web users on /login and native users on MobileOnboarding.
 */
function SetupRoute() {
  const onboardingV4 = useOnboardingV4Flag();

  return (
    <Show when={!onboardingV4().loading} fallback={<LoadingBlock />}>
      <Show when={onboardingV4().enabled} fallback={<Navigate href="/" />}>
        <SetupRedirect />
      </Show>
    </Show>
  );
}

/**
 * Web/desktop gate for /onboarding. Waits for PostHog to report flags before
 * bouncing: with the flag on but not yet loaded, a direct visit (or a reload
 * mid-flow) would otherwise get kicked to /login and lose its ?next.
 */
function OnboardingRoute() {
  const onboardingV4 = useOnboardingV4Flag();

  return (
    <Show when={!onboardingV4().loading} fallback={<LoadingBlock />}>
      <Show when={onboardingV4().enabled} fallback={<Navigate href="/login" />}>
        <OnboardingFlow />
      </Show>
    </Show>
  );
}

const ROUTES: RouteDefinition[] = [
  {
    path: '/task-slug/:taskSlug',
    component: TaskRoute,
  },
  LAYOUT_ROUTE,
  /** BEGIN - APP ROUTES */
  {
    path: '/inbox',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/recent',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/activity',
    component: LAYOUT_ROUTE.component,
  },
  {
    path: '/reminders',
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
    component: () => <Login signupMode />,
  },
  {
    path: EMAIL_CALLBACK_PATH,
    component: EmailCallback,
  },
  {
    path: EMAIL_LINK_CALLBACK_PATH,
    component: EmailLinkCallback,
  },
  {
    path: '/login/popup/success',
    component: () => {
      onMount(() => {
        publishLoginSuccess();
        window.close();
      });

      onCleanup(() => {
        window.close();
      });

      return (
        <div class="h-full overflow-y-hidden">
          <div class="relative flex flex-row items-center pt-4 h-full">
            <Button
              variant="outline"
              onClick={() => {
                publishLoginSuccess();
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
    component: () =>
      isNativeMobilePlatform() ? <MobileAuthWelcome /> : <Login />,
  },
  {
    // Mobile-web visitors can't sign up on a phone, so instead of pushing them
    // through Google SSO + onboarding we capture their email and email them a
    // link to open on desktop. The marketing site redirects mobile browsers
    // here.
    path: '/mobile-email-signup',
    component: MobileWebSignup,
  },
  {
    path: '/onboarding',
    // Flag-gated at the route, not just the redirect: with the flag off a
    // direct visit must not touch the onboarding backend (reading it
    // creates the flow's row and starts gathers).
    component: () =>
      isNativeMobilePlatform() ? <MobileOnboarding /> : <OnboardingRoute />,
  },
  {
    // Preserve the query (?next deep links) when forwarding to /onboarding.
    path: '/setup',
    component: SetupRoute,
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

/** Sets user info for observability, analytics, and login cookie. Must be inside QueryClientProvider. */
function UserInfoSideEffects() {
  const analytics = useAnalytics();
  const posthog = usePosthog();

  useSyncLoginCookie();

  // Set user info for observability and analytics
  const userInfo = useUserInfo();

  // Keep the active theme following the OS color scheme when auto-detect is on.
  systemThemeEffect();

  let identified = false;
  let syncedPlanKey: string | undefined;
  createEffect(
    on(userInfo, (user) => {
      // Keep telemetry user context in sync with auth state: set on every
      // authenticated load, and clear on logout so spans and logs aren't
      // attributed to a signed-out user. Logout flips userInfo client-side,
      // and on native mobile it's an SPA navigation with no page reload, so
      // this effect is what clears it there.
      Telemetry.config.setUser(user?.authenticated ? user.id : undefined);

      if (!user || !user.authenticated) {
        syncedPlanKey = undefined;
        return;
      }

      if (!posthog.instance._isIdentified() && !identified) {
        identified = true;

        const platform = detect(navigator.userAgent);
        const os = platform?.os?.replaceAll(' ', '');

        analytics.identify(user.id, {
          email: user.email,
          os,
        });
      }

      const planKey = `${user.id}:${user.licenseStatus}`;
      if (syncedPlanKey !== planKey) {
        syncedPlanKey = planKey;
        analytics.setPlanProperties(user.licenseStatus);
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

function MaybeWorkspaceShell(props: ParentProps) {
  const isAuthenticated = useIsAuthenticated();

  let lastAuthState: boolean | undefined;
  createEffect(() => {
    const authState = isAuthenticated();
    if (authState === lastAuthState) return;
    lastAuthState = authState;
    // #region agent log
    devPerfLog('C', 'Root.tsx:495', 'workspace shell auth state', {
      pathname: window.location.pathname,
      authenticated: authState,
    });
    // #endregion
  });

  let loggedAuthenticatedShell = false;
  createEffect(() => {
    if (isAuthenticated() !== true || loggedAuthenticatedShell) return;
    loggedAuthenticatedShell = true;
    // #region agent log
    devPerfLog('C', 'Root.tsx:497', 'authenticated workspace shell path', {
      pathname: window.location.pathname,
      authenticated: isAuthenticated(),
    });
    // #endregion
  });

  return (
    <Show when={isAuthenticated() === true} fallback={props.children}>
      <Suspense fallback={<LoadingBlock />}>
        <WorkspaceProviders>{props.children}</WorkspaceProviders>
      </Suspense>
    </Show>
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
                <UserInfoSideEffects />
                <MaybeWorkspaceShell>
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
                </MaybeWorkspaceShell>
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
