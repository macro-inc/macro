import { GlobalShareInboxConflictDialog } from '@app/features/inbox/ShareInboxConflictDialog';
import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { SearchProvider } from '@app/features/soup/search/context';
import { useInvalidateQueriesOnReconnect } from '@app/lib/queries/invalidate-on-reconnect';
import { globalSplitManager } from '@app/signal/splitLayout';
import { IncomingCallEvents } from '@block-call/sidebar/incoming-calls';
import { CallProvider } from '@channel/Call/CallContext';
import { CallStartedNotifier } from '@channel/Call/CallStartedNotifier';
import { CallKitSync } from '@channel/Call/use-callkit';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { ReactiveFavicon } from '@components/app/ReactiveFavicon';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
import { ENABLE_ONBOARDING_V4_OVERRIDE } from '@core/constant/featureFlags';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess';
import { TeamContextProvider } from '@core/context/team';
import { useUserId } from '@core/context/user';
import { initAndStartEmailSync } from '@core/email-link';
import { IosPushNotificationModal } from '@core/mobile/IosPushNotificationModal';
import { IpadUnsupportedDialog } from '@core/mobile/IpadUnsupportedDialog';
import { isMobile } from '@core/mobile/isMobile';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { createBlockOrchestrator } from '@core/orchestrator';
import {
  BrowserNotificationModal,
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
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';

const InteractiveOnboardingModal = lazy(() =>
  import('@app/features/onboarding/InteractiveOnboardingModal').then(
    (module) => ({ default: module.InteractiveOnboardingModal })
  )
);
const SoupBackfillSideEffect = lazy(() =>
  import('@queries/soup/SoupBackfillSideEffect').then((module) => ({
    default: module.SoupBackfillSideEffect,
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
  return (
    <TeamContextProvider>
      <BrowserNotificationModal />
      <IosPushNotificationModal />
      <IpadUnsupportedDialog />
      <GlobalShareInboxConflictDialog />
      <QuerySyncProviderWithUserId />
      <SoupBackfillWhenReady />
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
                  {props.children}
                  <Suspense>
                    <InitialInteractiveOnboardingModal />
                  </Suspense>
                </SearchProvider>
              </QuickAccessProvider>
            </CallProvider>
          </ChannelsContextProvider>
        </MutationUndoProvider>
      </ConfiguredGlobalAppStateProvider>
    </TeamContextProvider>
  );
}
