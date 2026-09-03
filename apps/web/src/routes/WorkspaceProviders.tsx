import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { useInvalidateQueriesOnReconnect } from '@app/lib/queries/invalidate-on-reconnect';
import { globalSplitManager } from '@app/signal/splitLayout';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { ENABLE_ONBOARDING_V4_OVERRIDE } from '@core/constant/featureFlags';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { TeamContextProvider } from '@core/context/team';
import { useUserId } from '@core/context/user';
import { initAndStartEmailSync } from '@core/email-link';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import { devPerfLog } from '@core/util/devPerf';
import {
  createNotificationSource,
  type UnifiedNotification,
  useNotificationUpdates,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useChatRenameWebsocketSync } from '@queries/chat';
import { QuerySyncProvider } from '@queries/sync/SyncProvider';
import { MutationUndoProvider } from '@queries/undo';
import { useReopenTrackedEntitiesOnReconnect } from '@service-connection/client';
import { ws as connectionGatewayWebsocket } from '@service-connection/websocket';
import {
  createEffect,
  createSignal,
  lazy,
  onMount,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';

const AuthenticatedCallProviders = lazy(() =>
  import('./AuthenticatedCallProviders').then((module) => ({
    default: module.AuthenticatedCallProviders,
  }))
);
const InteractiveOnboardingModal = lazy(() =>
  import('@app/features/onboarding/InteractiveOnboardingModal').then(
    (module) => ({ default: module.InteractiveOnboardingModal })
  )
);
const SearchProvider = lazy(() =>
  import('@app/features/soup/search/SearchProvider').then((module) => ({
    default: module.SearchProvider,
  }))
);
const SoupBackfillSideEffect = lazy(() =>
  import('@queries/soup/SoupBackfillSideEffect').then((module) => ({
    default: module.SoupBackfillSideEffect,
  }))
);
const WorkspaceModals = lazy(() =>
  import('./WorkspaceModals').then((module) => ({
    default: module.WorkspaceModals,
  }))
);
const ChatAttachmentsInit = lazy(() =>
  import('@core/component/AI/signal/globalAttachments').then((module) => ({
    default: module.ChatAttachmentsInit,
  }))
);
const ReactiveFavicon = lazy(() =>
  import('@components/app/ReactiveFavicon').then((module) => ({
    default: module.ReactiveFavicon,
  }))
);

function ConfiguredGlobalAppStateProvider(props: ParentProps) {
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

function QuerySyncProviderWithUserId() {
  const userId = useUserId();
  return <QuerySyncProvider userId={userId} />;
}

function SoupBackfillWhenReady() {
  const userId = useUserId();
  return (
    <Show when={userId()} keyed>
      {(id) => (
        <Suspense>
          <SoupBackfillSideEffect userId={id} />
        </Suspense>
      )}
    </Show>
  );
}

function InitialInteractiveOnboardingModal() {
  const userInfoQuery = useUserInfoQuery();
  const onboardingV4 = useOnboardingV4Flag();
  const [open, setOpen] = createSignal(true);
  const [onboardingStarted, setOnboardingStarted] = createSignal(false);
  let lastOnboardingState: string | undefined;

  const modalOpen = () =>
    open() &&
    ENABLE_ONBOARDING_V4_OVERRIDE !== false &&
    (isMobile() || (!onboardingV4().loading && !onboardingV4().enabled)) &&
    !isNativeMobilePlatform() &&
    userInfoQuery.data?.authenticated === true &&
    (userInfoQuery.data.tutorialComplete === false || onboardingStarted());

  createEffect(() => {
    if (modalOpen()) {
      setOnboardingStarted(true);
    }
  });

  createEffect(() => {
    const nextState = modalOpen() ? 'open' : 'skipped';
    if (lastOnboardingState === nextState) return;
    lastOnboardingState = nextState;
    // #region agent log
    devPerfLog(
      'F',
      'WorkspaceProviders.tsx:139',
      'interactive onboarding state',
      {
        pathname: window.location.pathname,
        state: nextState,
        authenticated: userInfoQuery.data?.authenticated,
        tutorialComplete: userInfoQuery.data?.tutorialComplete,
        onboardingLoading: onboardingV4().loading,
        onboardingEnabled: onboardingV4().enabled,
      }
    );
    // #endregion
  });

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

export default function WorkspaceProviders(props: ParentProps) {
  onMount(() => {
    // #region agent log
    devPerfLog(
      'E',
      'WorkspaceProviders.tsx:183',
      'workspace providers mounted',
      {
        pathname: window.location.pathname,
      }
    );
    // #endregion
  });

  return (
    <TeamContextProvider>
      <EmailLinksContextProvider>
        <Suspense>
          <WorkspaceModals />
        </Suspense>
        <QuerySyncProviderWithUserId />
        <SoupBackfillWhenReady />
        <ConfiguredGlobalAppStateProvider>
          <MutationUndoProvider>
            <ChannelsContextProvider>
              <QuickAccessProvider>
                <Suspense fallback={props.children}>
                  <SearchProvider>
                    <Suspense fallback={props.children}>
                      <AuthenticatedCallProviders>
                        <Suspense>
                          <ChatAttachmentsInit />
                        </Suspense>
                        <Suspense>
                          <ReactiveFavicon />
                        </Suspense>
                        {props.children}
                        <Suspense>
                          <InitialInteractiveOnboardingModal />
                        </Suspense>
                      </AuthenticatedCallProviders>
                    </Suspense>
                  </SearchProvider>
                </Suspense>
              </QuickAccessProvider>
            </ChannelsContextProvider>
          </MutationUndoProvider>
        </ConfiguredGlobalAppStateProvider>
      </EmailLinksContextProvider>
    </TeamContextProvider>
  );
}
