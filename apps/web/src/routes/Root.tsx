import { ROUTER_BASE } from '@app/constants/routerBase';
import { usePendingInviteRedemption } from '@app/features/gtm-invite/usePendingInviteRedemption';
import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { MeetingSessionProvider } from '@app/features/meetings/meeting-session-provider';
import {
  AnalyticsContextProvider,
  useAnalytics,
} from '@app/lib/analytics/analytics-context';
import { PosthogProvider, usePosthog } from '@app/lib/analytics/posthog';
import { trackSignupCompletion } from '@app/lib/analytics/signupCompletion';
import { setHotkeyRoot } from '@app/signal/hotkeyRoot';
import { IncomingCallEvents } from '@block-call/sidebar/incoming-calls';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { CallKitSync } from '@channel/Call/use-callkit';
import { dismissBootShell } from '@components/app/boot-shell';
import { RootFrame } from '@components/app/Layout';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { UserContextProvider, useUserInfo } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { IosPushNotificationModal } from '@core/mobile/IosPushNotificationModal';
import { IpadUnsupportedDialog } from '@core/mobile/IpadUnsupportedDialog';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import {
  getLoginCookieOptions,
  setCookie,
  syncLoginStorage,
  updateCookie,
} from '@core/util/cookies';
import { licenseChannel } from '@core/util/licenseUpdateBroadcastChannel';
import { isTauri } from '@core/util/platform';
import { transformShortIdInUrlPathname } from '@core/util/url';
import { EntityProvider } from '@entity';
import { MaybeTauriProvider } from '@macro/tauri';
import { TauriRouteListener } from '@macro/tauri/TauriProvider';
import { Telemetry } from '@macro-inc/observability';
import { BrowserNotificationModal } from '@notifications';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { MetaProvider, Title } from '@solidjs/meta';
import {
  HashRouter,
  type RouteDefinition,
  type RoutePreloadFunc,
  Router,
  type RouterProps,
  type RouteSectionProps,
} from '@solidjs/router';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  resolveActiveThemeId,
  systemThemeEffect,
} from '@theme/utils/themeUtils';
import { detect } from 'detect-browser';
import { createEffect, type JSX, on, onCleanup, onMount } from 'solid-js';
import { AppRouterView } from './app-router-view';

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

/** The split router handles every path; its route tree is in `app-router-view.tsx`. */
const ROUTES: RouteDefinition[] = [
  { path: '/*path', component: AppRouterView },
];

/** Syncs the signed-in user to observability, analytics, and the login cookie. */
function useUserInfoSideEffects() {
  const analytics = useAnalytics();
  const posthog = usePosthog();

  useSyncLoginCookie();

  // A signup that started from a GTM invite link finishes its attribution on
  // the first authenticated load (the welcome page parked the token).
  usePendingInviteRedemption();

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
}

const clearBodyInlineStyleColor = () => {
  // index.html has inline script to set page color to theme surface to prevent page color flash.
  // removes page color inline style to prevent overriding main stylesheet
  document.body.style.backgroundColor = '';
};

/** Longest the boot shell waits for a shell to draw before showing whatever the app has. */
const BOOT_SHELL_MAX_WAIT_MS = 8000;

/**
 * The router's root: the frame every page shares. Each route's shell decides
 * its own chrome and hands off from index.html's boot shell when it mounts;
 * the cap keeps an outage from hiding the app's own error states.
 */
function AppRouteFrame(props: RouteSectionProps) {
  useUserInfoSideEffects();
  onMount(() => {
    const cap = setTimeout(dismissBootShell, BOOT_SHELL_MAX_WAIT_MS);
    onCleanup(() => clearTimeout(cap));
  });
  return <RootFrame>{props.children}</RootFrame>;
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
                <EmailLinksContextProvider>
                  <BrowserNotificationModal />
                  <IosPushNotificationModal />
                  <IpadUnsupportedDialog />
                  <GlobalShareInboxConflictDialog />
                  <ChannelsContextProvider>
                    <CallProvider>
                      <CallKitSync />
                      <CallStartedNotifier />
                      <IncomingCallEvents />
                      <QuickAccessProvider>
                        <Title>{tabTitle()}</Title>
                        <MeetingSessionProvider>
                          {/* Loading boundaries belong inside RootFrame so
                                    a pending resource cannot detach the frame. */}
                          <IsomorphicRouter
                            transformUrl={transformShortIdInUrlPathname}
                            root={AppRouteFrame}
                            rootPreload={rootPreload}
                            base={ROUTER_BASE}
                          >
                            {{
                              path: '/',
                              component: TauriRouteListener,
                              children: ROUTES,
                            }}
                          </IsomorphicRouter>
                        </MeetingSessionProvider>
                        <ToastRegion />
                      </QuickAccessProvider>
                    </CallProvider>
                  </ChannelsContextProvider>
                </EmailLinksContextProvider>
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
