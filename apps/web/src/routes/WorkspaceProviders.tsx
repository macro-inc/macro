import { usePendingNotificationNavigationEffect } from '@app/features/notifications/PendingNotificationNavigationEffect';
import { InteractiveOnboardingModal } from '@app/features/onboarding/InteractiveOnboardingModal';
import { useOnboardingV4Flag } from '@app/features/setup/flow/useOnboardingV4Flag';
import { SearchProvider } from '@app/features/soup/search/context';
import { useInvalidateQueriesOnReconnect } from '@app/lib/queries/invalidate-on-reconnect';
import { globalSplitManager } from '@app/signal/splitLayout';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { ReactiveFavicon } from '@components/app/ReactiveFavicon';
import { ChatAttachmentsInit } from '@core/component/AI/signal/globalAttachments';
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
import {
  createNotificationSource,
  type UnifiedNotification,
  useNotificationUpdates,
  usePlatformNotificationState,
} from '@notifications';
import { maybeHandlePlatformNotification } from '@notifications/notification-platform';
import { useUserInfoQuery } from '@queries/auth/user-info';
import { useChatRenameWebsocketSync } from '@queries/chat';
import { SoupBackfillSideEffect } from '@queries/soup/SoupBackfillSideEffect';
import { QuerySyncProvider } from '@queries/sync/SyncProvider';
import { MutationUndoProvider } from '@queries/undo';
import { useReopenTrackedEntitiesOnReconnect } from '@service-connection/client';
import { ws as connectionGatewayWebsocket } from '@service-connection/websocket';
import { createEffect, createSignal, type ParentProps, Show } from 'solid-js';
import { AuthenticatedCallProviders } from './AuthenticatedCallProviders';
import { WorkspaceModals } from './WorkspaceModals';

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
      {(id) => <SoupBackfillSideEffect userId={id} />}
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
      <EmailLinksContextProvider>
        <WorkspaceModals />
        <QuerySyncProviderWithUserId />
        <SoupBackfillWhenReady />
        <ConfiguredGlobalAppStateProvider>
          <MutationUndoProvider>
            <ChannelsContextProvider>
              <AuthenticatedCallProviders>
                <QuickAccessProvider>
                  <SearchProvider>
                    <ChatAttachmentsInit />
                    <ReactiveFavicon />
                    {props.children}
                    <InitialInteractiveOnboardingModal />
                  </SearchProvider>
                </QuickAccessProvider>
              </AuthenticatedCallProviders>
            </ChannelsContextProvider>
          </MutationUndoProvider>
        </ConfiguredGlobalAppStateProvider>
      </EmailLinksContextProvider>
    </TeamContextProvider>
  );
}
