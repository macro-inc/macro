import { ROUTER_BASE, ROUTER_BASE_CONCAT } from '@app/constants/routerBase';
import { setCookie } from '@app/features/auth/Shared';
import { usePendingInviteRedemption } from '@app/features/gtm-invite/usePendingInviteRedemption';
import { HomePreferencesProvider } from '@app/features/home/home-prefs';
import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { IncomingMeetingInvitationsProvider } from '@app/features/meetings/incoming-meeting-invitations';
import { MeetingSessionProvider } from '@app/features/meetings/meeting-session-provider';
import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { InteractiveOnboardingModal } from '@app/features/onboarding/InteractiveOnboardingModal';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { SearchProvider } from '@app/features/soup/search/context';
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
import { isMeetingPath } from '@channel/Call/call-link';
import { CallKitSync } from '@channel/Call/use-callkit';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { Layout } from '@components/app/Layout';
import { ReactiveFavicon } from '@components/app/ReactiveFavicon';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { enableOnboardingV4 } from '@core/constant/featureFlags';
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
import {
  useRefreshTrackedEntitiesOnFocus,
  useReopenTrackedEntitiesOnReconnect,
} from '@service-connection/client';
import { ws as connectionGatewayWebsocket } from '@service-connection/websocket';
import { MetaProvider, Title } from '@solidjs/meta';
import {
  HashRouter,
  type RouteDefinition,
  type RoutePreloadFunc,
  Router,
  type RouterProps,
  type RouteSectionProps,
  useLocation,
} from '@solidjs/router';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  resolveActiveThemeId,
  systemThemeEffect,
} from '@theme/utils/themeUtils';
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
} from 'solid-js';
import { useReminderAlerts } from '../features/reminders/reminder-alerts';
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

function ConfiguredGlobalAppStateProvider(props: ParentProps) {
  const userId = useUserId();
  // Initialize global notification helpers
  const notifInterface = usePlatformNotificationState();
  useChatRenameWebsocketSync();
  useReopenTrackedEntitiesOnReconnect();
  useRefreshTrackedEntitiesOnFocus();

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
  useReminderAlerts(notificationSource);

  const blockOrchestrator = createBlockOrchestrator();
  usePendingNotificationNavigationEffect(notificationSource);

  return (
    <GlobalAppStateProvider
      notificationSource={notificationSource}
      blockOrchestrator={blockOrchestrator}
    >
      <HomePreferencesProvider userId={userId}>
        {props.children}
      </HomePreferencesProvider>
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
    enableOnboardingV4.override !== false &&
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

/** Meeting and booking links have a focused shell and skip app onboarding. */
function AppRouteLayout(props: RouteSectionProps) {
  const location = useLocation();
  return (
    <Show
      when={
        !(
          location.pathname.startsWith(`${ROUTER_BASE_CONCAT}book/`) ||
          location.pathname.startsWith(`${ROUTER_BASE_CONCAT}booking/`)
        )
      }
      fallback={
        <div class="h-dvh overflow-y-auto bg-page text-ink">
          {props.children}
        </div>
      }
    >
      <IncomingMeetingInvitationsProvider>
        <Show
          when={!isMeetingPath(location.pathname)}
          fallback={props.children}
        >
          <Layout {...props} />
          <InitialInteractiveOnboardingModal />
        </Show>
      </IncomingMeetingInvitationsProvider>
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
                                <MeetingSessionProvider>
                                  {/* Loading boundaries belong inside Layout so
                                    a pending resource cannot detach the app shell. */}
                                  <IsomorphicRouter
                                    transformUrl={transformShortIdInUrlPathname}
                                    root={AppRouteLayout}
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
