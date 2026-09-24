import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import { useChannelBotManagement } from '@channel/Bots/use-channel-bot-management';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallEventSync } from '@channel/Call/CallEventSync';
import { ChannelCallButton } from '@channel/Call/ChannelCallButton';
import { ChannelCallTab } from '@channel/Call/ChannelCallTab';
import { useCall } from '@channel/Call/use-call';
import { ChannelCallsTab } from '@channel/Calls/ChannelCallsTab';
import { ChannelTopIcon } from '@channel/components/ChannelTopIcon';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TabsInset } from '@core/component/TabsInset';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelName, useChannelType } from '@core/context/channels';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import {
  type Accessor,
  children,
  createComputed,
  createMemo,
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
import { ChannelTabProvider, useChannelTab } from './ChannelTabContext';
import { ChannelLiveIndicators } from './ChannelTopBarLiveIndicators';
import { type ChannelTabId, DEFAULT_CHANNEL_TAB } from './channel-tabs';
import {
  canUseInlineCallTab,
  normalizeChannelTab,
  useChannelTabItems,
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
  navigationRequest?: number;
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

export function ChannelDetailTabs(props: { channelId: string }) {
  const { activeTab, setActiveTab } = useChannelTab();
  const tabs = useChannelTabItems(props.channelId);

  return (
    <TabsInset
      list={tabs()}
      value={activeTab()}
      onChange={(value) => setActiveTab(value as ChannelTabId)}
    />
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
    <div class="header-actions ml-auto flex shrink-0 items-center gap-2">
      <ChannelLiveIndicators channelId={props.channelId} />
      <Show when={ENABLE_CALLS && !call.isInThisChannel()}>
        <ChannelCallButton channelId={props.channelId} />
      </Show>
      <Show when={askMacroEntity()}>
        {(entity) => (
          <ChatWithAgentButton entity={entity()} label="Ask Macro" />
        )}
      </Show>
    </div>
  );
}

export function ChannelDetailTopBar(props: ChannelDetailHeaderProps) {
  return (
    <ViewShell.TopBar class="gap-3">
      <ChannelDetailTitle {...props} />
      <ChannelDetailTabs channelId={props.channelId} />
      <ChannelDetailActions {...props} />
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
  const channelId = props.channelId;
  const channelName = useChannelName(channelId, props.fallbackName);

  // Convert the value-semantic target prop into identity-stable surface
  // requests: only a changed target or explicit re-open produces a new request.
  let lastTargetKey: string | undefined;
  const targetRequest = createMemo<ChannelTargetRequest | undefined>(
    (previous) => {
      const target = props.target;
      const location = !target
        ? ''
        : target.kind === 'latest'
          ? 'latest'
          : `${target.messageId}:${target.threadId ?? ''}`;
      const key = `${location}:${props.navigationRequest ?? 0}`;
      if (lastTargetKey !== undefined && key === lastTargetKey) return previous;
      lastTargetKey = key;
      return target ? { ...target } : undefined;
    }
  );

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
      <CallEventSync />
      <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
        <div class="flex size-full min-h-0 flex-col">
          <ChannelDetailHeader
            render={props.children}
            context={{
              channelId,
              name: () => channelName() ?? 'New Channel',
            }}
          />
          <div class="flex min-h-0 flex-1 flex-col px-2">
            <Switch>
              <Match when={activeTab() === 'messages'}>
                <ChannelMessages autofocus={props.autofocus ?? false} />
              </Match>
              <Match when={activeTab() === 'attachments'}>
                <ChannelAttachmentsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'calls' && ENABLE_CALLS}>
                <ChannelCallsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'participants'}>
                <ChannelParticipantsTab
                  channelId={channelId}
                  botManagementEnabled={botManagement.enabled()}
                  onCreateBot={botManagement.openCreateBot}
                  inviteBotFocusRequest={botManagement.inviteFocusRequest()}
                  onOpenBot={botManagement.openBot}
                />
              </Match>
              <Match when={activeTab() === 'call' && canUseInlineCallTab()}>
                <ChannelCallTab
                  channelId={channelId}
                  pendingJoin={() => false}
                />
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
      {(channelId) => <ChannelDetailContent {...props} channelId={channelId} />}
    </Show>
  );
}
