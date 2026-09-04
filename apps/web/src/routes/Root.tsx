import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { ROUTER_BASE } from '@app/constants/routerBase';
import { makeEmailAuthComponents } from '@app/features/auth/EmailAuth';
import { Login } from '@app/features/auth/Login';
import { MobileAuthWelcome } from '@app/features/auth/mobile-onboarding/MobileAuthWelcome';
import { MobileOnboarding } from '@app/features/auth/mobile-onboarding/MobileOnboarding';
import { setCookie } from '@app/features/auth/Shared';
import { ChannelInviteAcceptance } from '@app/features/channel-invitations/ChannelInviteAcceptance';
import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { SearchProvider } from '@app/features/next-soup/search-context';
import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { InteractiveOnboardingModal } from '@app/features/onboarding/InteractiveOnboardingModal';
import MobileWebSignup from '@app/features/onboarding/MobileWebSignup';
import { OnboardingFlow } from '@app/features/setup/flow/OnboardingFlow';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
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
import { IncomingCallEvents } from '@block-call/sidebar/incoming-calls';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { CallKitSync } from '@channel/Call/use-callkit';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { Layout } from '@components/app/Layout';
import { ReactiveFavicon } from '@components/app/ReactiveFavicon';
import { LAYOUT_ROUTE } from '@components/app/split-layout/SplitLayoutRoute';
import { publishLoginSuccess } from '@core/auth/login-events';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ENABLE_ONBOARDING_V4_OVERRIDE } from '@core/constant/featureFlags';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
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
import { IpadUnsupportedDialog } from '@core/mobile/IpadUnsupportedDialog';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import { formatTabTitle, tabTitleSignal } from '@core/signal/tabTitle';
import {
  getLoginCookieOptions,
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
import {
  BrowserNotificationModal,
  createNotificationSource,
  type UnifiedNotification,
  useNotificationUpdates,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import {
  invalidateUserInfo,
  prefetchUserInfo,
  useUserInfoQuery,
} from '@queries/auth/user-info';
import { useChatRenameWebsocketSync } from '@queries/chat';
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
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { BasePathComponent } from './BasePath';
import { TaskRoute } from './TaskRoute';

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
  useNotificationUpdates(notificationSource);

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

function SoupBackfillSideEffect(props: { userId: string }) {
  useSoupBackfills(props.userId);
  return null;
}

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

  return (
    <Show when={userInfo()?.id} keyed>
      {(userId) => <SoupBackfillSideEffect userId={userId} />}
    </Show>
  );
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
  const onboardingV4 = useOnboardingV4Flag();
  const [open, setOpen] = createSignal(true);
  const [onboardingStarted, setOnboardingStarted] = createSignal(false);

  const modalOpen = () =>
    open() &&
    // `just run_local` sets VITE_ENABLE_ONBOARDING_V4=false; without this the
    // v4-off fallback would still open this legacy modal. Opt in with
    // `just run_local --enable-onboarding`.
    ENABLE_ONBOARDING_V4_OVERRIDE !== false &&
    // Onboarding-v4 replaces this modal on desktop; the Layout redirect
    // sends first-time users to /onboarding instead. Desktop waits for the
    // flag to resolve so this doesn't flash before that redirect fires.
    (isMobile() || (!onboardingV4().loading && !onboardingV4().enabled)) &&
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
                <EmailLinksContextProvider>
                  <BrowserNotificationModal />
                  <IosPushNotificationModal />
                  <IpadUnsupportedDialog />
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
                            <IncomingCallEvents />
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
