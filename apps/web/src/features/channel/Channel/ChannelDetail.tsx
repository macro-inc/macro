import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import { useChannelBotManagement } from '@channel/Bots/use-channel-bot-management';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallEventSync } from '@channel/Call/CallEventSync';
import { ChannelCallAutoJoin } from '@channel/Call/ChannelCallAutoJoin';
import { ChannelCallButton } from '@channel/Call/ChannelCallButton';
import { ChannelCallTab } from '@channel/Call/ChannelCallTab';
import { getCallJoinTab } from '@channel/Call/call-tabs';
import { useCall } from '@channel/Call/use-call';
import { ChannelCallsTab } from '@channel/Calls/ChannelCallsTab';
import { ChannelInviteButton } from '@channel/channel-invite-button';
import { ChannelTopIcon } from '@channel/components/ChannelTopIcon';
import { DebugSuspense } from '@channel/DebugSuspense';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import {
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelName, useChannelType } from '@core/context/channels';
import { createMethodRegistration } from '@core/orchestrator';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import {
  type Accessor,
  children,
  createComputed,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import {
  ChannelMessages,
  ChannelSurface,
  type ChannelTargetRequest,
} from './ChannelSurface';
import { ChannelTabProvider } from './ChannelTabContext';
import { ChannelTabs } from './ChannelTabs';
import { ChannelLiveIndicators } from './ChannelTopBarLiveIndicators';
import { type ChannelTabId, DEFAULT_CHANNEL_TAB } from './channel-tabs';
import {
  isJoinCallRequested,
  isOpenCallTabRequested,
  toChannelTargetRequest,
  URL_PARAMS,
} from './link';
import {
  canUseInlineCallTab,
  normalizeChannelTab,
} from './use-channel-tab-items';

export type ChannelDetailContext = {
  channelId: string;
  name: Accessor<string>;
};

export type ChannelDetailProps = {
  channelId: string;
  /**
   * Navigation target, compared by value: a changed value re-navigates, a
   * re-derived equal value does not. A host that needs identity-request
   * semantics (re-issuing the same target navigates again) should compose
   * ChannelSurface directly.
   */
  target?: ChannelTargetRequest;
  /** Re-aim the current target without remounting the channel. */
  navigationRequest?: number | string;
  /** Name shown until the channel loads. */
  fallbackName?: string;
  /** Whether the composer grabs focus on mount. Defaults to false. */
  autofocus?: boolean;
  /** Render the host's header and register any host-specific breadcrumbs. */
  children: (context: ChannelDetailContext) => JSX.Element;
};

type ChannelDetailHeaderProps = {
  channelId: string;
  fallbackName?: string;
};

export function ChannelDetailTitle(props: ChannelDetailHeaderProps) {
  const channelName = useChannelName(props.channelId, props.fallbackName);
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const participants = () =>
    participantsQuery.isSuccess ? (participantsQuery.data ?? []) : [];

  return (
    <div class="ph-no-capture flex min-w-0 shrink items-center gap-2">
      <ChannelTopIcon
        channelId={props.channelId}
        channelType={channelType()}
        participants={participants()}
      />
      <span class="truncate text-sm font-semibold">
        {channelName() ?? 'New Channel'}
      </span>
    </div>
  );
}

export function ChannelDetailActions(props: ChannelDetailHeaderProps) {
  const channelName = useChannelName(props.channelId, props.fallbackName);
  const channelType = useChannelType(props.channelId);
  const call = useCall(() => props.channelId);

  // Seed for "Ask Macro": a new chat with this channel @mentioned.
  const askMacroEntity = () => {
    const type = channelType();
    if (!type) return undefined;
    return {
      type: 'channel' as const,
      id: props.channelId,
      name: channelName() ?? 'New Channel',
      channelType: type,
    };
  };

  return (
    <div class="header-actions ml-auto flex shrink-0 items-center gap-1">
      <DebugSuspense name="ChannelDetail.live-indicators">
        <ChannelLiveIndicators channelId={props.channelId} />
      </DebugSuspense>
      <DebugSuspense name="ChannelDetail.invite">
        <ChannelInviteButton
          channelId={props.channelId}
          channelName={channelName() ?? 'New Channel'}
          channelType={channelType()}
        />
      </DebugSuspense>
      <Show when={ENABLE_CALLS && !call.isInThisChannel()}>
        <DebugSuspense name="ChannelDetail.call-button">
          <ChannelCallButton channelId={props.channelId} />
        </DebugSuspense>
      </Show>
      <Show when={askMacroEntity()}>
        {(entity) => (
          <DebugSuspense name="ChannelDetail.ask-macro">
            <ChatWithAgentButton entity={entity()} label="Ask Macro" />
          </DebugSuspense>
        )}
      </Show>
    </div>
  );
}

/** Channel identity and actions; content navigation lives below this bar. */
export function ChannelDetailTopBar(
  props: ChannelDetailHeaderProps & { leading?: JSX.Element }
) {
  return (
    <ViewShell.TopBar class="gap-3">
      <div class="flex min-w-0 shrink items-center gap-3 overflow-hidden">
        <DebugSuspense name="ChannelDetail.title">
          <Show
            when={props.leading}
            fallback={
              <ChannelDetailTitle
                channelId={props.channelId}
                fallbackName={props.fallbackName}
              />
            }
          >
            {props.leading}
          </Show>
        </DebugSuspense>
      </div>
      <DebugSuspense name="ChannelDetail.actions">
        <ChannelDetailActions
          channelId={props.channelId}
          fallbackName={props.fallbackName}
        />
      </DebugSuspense>
    </ViewShell.TopBar>
  );
}

function ChannelDetailHeader(props: {
  render: ChannelDetailProps['children'];
  context: ChannelDetailContext;
}) {
  const resolved = children(() => props.render(props.context));
  return <>{resolved()}</>;
}

function ChannelDetailContent(props: ChannelDetailProps) {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const channelId = props.channelId;
  const channelName = useChannelName(channelId, props.fallbackName);
  useSplitDisplayName(() => channelName() ?? 'New Channel');

  const requestFromTarget = (
    target: ChannelTargetRequest | undefined
  ): ChannelTargetRequest | undefined => (target ? { ...target } : undefined);

  const targetKey = () => {
    const target = props.target;
    const location = !target
      ? ''
      : target.kind === 'latest'
        ? 'latest'
        : `${target.messageId}:${target.threadId ?? ''}`;
    return `${location}:${props.navigationRequest ?? 0}`;
  };

  // The surface navigates on a fresh request object. The host's `target` is
  // value-semantic, so it only produces one when its value changes; a mention
  // chip or notification arriving through the block handle always does.
  let lastTargetKey = targetKey();
  const [targetRequest, setTargetRequest] = createSignal<
    ChannelTargetRequest | undefined
  >(requestFromTarget(props.target));

  createComputed(() => {
    const key = targetKey();
    if (key === lastTargetKey) return;
    lastTargetKey = key;
    setTargetRequest(requestFromTarget(props.target));
  });

  const callCtx = useCallContextOptional();
  // A channel that owns this client's active call opens on the Call tab, so
  // selecting it never hides the live call — the block adapter's rule.
  const hasActiveCallHere = !!(
    callCtx?.isInCall() && callCtx.activeChannelId() === channelId
  );
  const [activeTab, setActiveTabInternal] = createSignal<ChannelTabId>(
    normalizeChannelTab(hasActiveCallHere ? 'call' : DEFAULT_CHANNEL_TAB)
  );
  const setActiveTab = (tab: ChannelTabId) => {
    setActiveTabInternal(normalizeChannelTab(tab));
  };
  const [pendingJoinCall, setPendingJoinCall] = createSignal(false);

  // A new target within the already-mounted channel (a notification jump)
  // must land on the messages pane, whichever tab is open.
  createComputed(
    on(
      targetRequest,
      (request) => {
        if (request) setActiveTab(DEFAULT_CHANNEL_TAB);
      },
      { defer: true }
    )
  );

  // Mention chips, notifications, and call deep links aim an open channel
  // through its block handle; without one the click only activates the view.
  createComputed(() => {
    const handle = orchestrator.registerBlockHandle('channel', channelId);
    createMethodRegistration(() => handle, {
      goToLocationFromParams: async (params: Record<string, unknown>) => {
        // Store any message target first: a request that also opens the call
        // tab leaves it waiting for whenever the user returns to Messages.
        const request = toChannelTargetRequest(params);
        if (request) setTargetRequest(request);

        if (isOpenCallTabRequested(params[URL_PARAMS.openCallTab])) {
          setActiveTab(getCallJoinTab());
          return;
        }

        if (isJoinCallRequested(params[URL_PARAMS.joinCall])) {
          setActiveTab(getCallJoinTab());
          setPendingJoinCall(true);
        }
      },
      goToLatest: async () => {
        setTargetRequest({ kind: 'latest' });
      },
    });
  });

  // CallContext: which channel has the Call tab selected (for isCallPage(), etc.).
  createComputed(() =>
    callCtx?.syncCallPageTab(channelId, activeTab() === 'call')
  );
  onCleanup(() => callCtx?.syncCallPageTab(channelId, false));

  const botManagement = useChannelBotManagement({
    channelId,
    hotkeyScopeId: panel.splitHotkeyScope,
    openParticipants: () => setActiveTab('participants'),
  });

  return (
    <ChannelSurface channelId={channelId} targetRequest={targetRequest()}>
      <DebugSuspense name="ChannelDetail.call-event-sync">
        <CallEventSync />
      </DebugSuspense>
      <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
        <DebugSuspense name="ChannelDetail.auto-join">
          <ChannelCallAutoJoin
            channelId={channelId}
            pendingJoinCall={pendingJoinCall}
            onHandled={() => setPendingJoinCall(false)}
          />
        </DebugSuspense>
        <div class="flex size-full min-h-0 flex-col">
          <DebugSuspense name="ChannelDetail.header">
            <ChannelDetailHeader
              render={props.children}
              context={{
                channelId,
                name: () => channelName() ?? 'New Channel',
              }}
            />
          </DebugSuspense>
          <div class="flex min-h-0 flex-1 flex-col px-2">
            <DebugSuspense name="ChannelDetail.tabs">
              <ChannelTabs channelId={channelId} />
            </DebugSuspense>
            <Switch>
              <Match when={activeTab() === 'messages'}>
                <DebugSuspense name="ChannelDetail.messages">
                  <ChannelMessages autofocus={props.autofocus ?? false} />
                </DebugSuspense>
              </Match>
              <Match when={activeTab() === 'attachments'}>
                <DebugSuspense name="ChannelDetail.attachments">
                  <ChannelAttachmentsTab channelId={channelId} />
                </DebugSuspense>
              </Match>
              <Match when={activeTab() === 'calls' && ENABLE_CALLS}>
                <DebugSuspense name="ChannelDetail.calls">
                  <ChannelCallsTab channelId={channelId} />
                </DebugSuspense>
              </Match>
              <Match when={activeTab() === 'participants'}>
                <DebugSuspense name="ChannelDetail.participants">
                  <ChannelParticipantsTab
                    channelId={channelId}
                    botManagementEnabled={botManagement.enabled()}
                    onCreateBot={botManagement.openCreateBot}
                    inviteBotFocusRequest={botManagement.inviteFocusRequest()}
                    onOpenBot={botManagement.openBot}
                  />
                </DebugSuspense>
              </Match>
              <Match when={activeTab() === 'call' && canUseInlineCallTab()}>
                <DebugSuspense name="ChannelDetail.call">
                  <ChannelCallTab
                    channelId={channelId}
                    pendingJoin={pendingJoinCall}
                  />
                </DebugSuspense>
              </Match>
            </Switch>
          </div>
        </div>
      </ChannelTabProvider>
    </ChannelSurface>
  );
}

/**
 * Channel body and per-channel tab state. Hosts compose the top bar from the
 * exported header parts through the children callback.
 *
 * Keys its content by channel id so switching channels remounts the timeline.
 * Hosts pass a reactive `channelId` and never key their own render.
 */
export function ChannelDetail(props: ChannelDetailProps) {
  return (
    <Show when={props.channelId} keyed>
      {(channelId) => (
        <DebugSuspense name="ChannelDetail.root">
          <ChannelDetailContent {...props} channelId={channelId} />
        </DebugSuspense>
      )}
    </Show>
  );
}
