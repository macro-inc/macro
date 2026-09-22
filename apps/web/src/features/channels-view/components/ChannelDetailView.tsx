import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { getChannelEntityTarget } from '@app/features/next-soup/utils';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import { useChannelBotManagement } from '@channel/Bots/use-channel-bot-management';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallEventSync } from '@channel/Call/CallEventSync';
import { ChannelCallButton } from '@channel/Call/ChannelCallButton';
import { ChannelCallTab } from '@channel/Call/ChannelCallTab';
import { useCall } from '@channel/Call/use-call';
import { ChannelCallsTab } from '@channel/Calls/ChannelCallsTab';
import {
  ChannelMessages,
  ChannelSurface,
  type ChannelTargetRequest,
} from '@channel/Channel/ChannelSurface';
import {
  ChannelTabProvider,
  useChannelTab,
} from '@channel/Channel/ChannelTabContext';
import { ChannelLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import {
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from '@channel/Channel/channel-tabs';
import {
  canUseInlineCallTab,
  normalizeChannelTab,
  useChannelTabItems,
} from '@channel/Channel/use-channel-tab-items';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { TabsInset } from '@core/component/TabsInset';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelName, useChannelType } from '@core/context/channels';
import type { ChannelEntity } from '@entity';
import {
  createComputed,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { ChannelAvatar } from './rail/ChannelRailItems';

function ChannelDetailTopBar(props: {
  channelId: string;
  channel: ChannelEntity;
}) {
  const { activeTab, setActiveTab } = useChannelTab();
  const tabs = useChannelTabItems(props.channelId);
  const channelName = useChannelName(props.channelId, props.channel.name);
  const channelType = useChannelType(props.channelId);
  const call = useCall(() => props.channelId);

  // Seed for "Ask Macro": a new chat with this channel @mentioned, so the
  // user does not have to create an agent and mention the channel by hand.
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
    <ViewShell.TopBar class="gap-3">
      <div class="ph-no-capture flex min-w-0 shrink items-center gap-2">
        <ChannelAvatar channel={props.channel} />
        <span class="truncate text-sm font-semibold">
          {channelName() ?? 'New Channel'}
        </span>
      </div>
      <TabsInset
        list={tabs()}
        value={activeTab()}
        onChange={(value) => setActiveTab(value as ChannelTabId)}
      />
      <div class="ml-auto flex shrink-0 items-center gap-2">
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
    </ViewShell.TopBar>
  );
}

function ChannelDetail(props: { channelId: string; channel: ChannelEntity }) {
  const panel = useSplitPanelOrThrow();
  const channelId = props.channelId;

  // Fresh metadata and notifications reconcile into a replacement entity for
  // the same selection; only an explicit target change should re-navigate
  // (PreviewPanel applied the same rule via its stringified navigation key).
  let lastTargetKey: string | undefined;
  const targetRequest = createMemo<ChannelTargetRequest | undefined>(
    (previous) => {
      const key = `${props.channel.target?.messageId ?? ''}:${
        props.channel.target?.threadId ?? ''
      }`;
      if (lastTargetKey !== undefined && key === lastTargetKey) return previous;
      lastTargetKey = key;
      const target = getChannelEntityTarget(props.channel);
      if (!target) return undefined;
      return target.kind === 'latest'
        ? { kind: 'latest' }
        : {
            kind: 'message',
            messageId: target.messageId,
            threadId: target.threadId,
          };
    }
  );

  const [activeTab, setActiveTabInternal] =
    createSignal<ChannelTabId>(DEFAULT_CHANNEL_TAB);
  const setActiveTab = (tab: ChannelTabId) => {
    setActiveTabInternal(normalizeChannelTab(tab));
  };

  // A new target within the already-selected channel (a notification jump)
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
  const callCtx = useCallContextOptional();
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
          <ChannelDetailTopBar channelId={channelId} channel={props.channel} />
          <div class="flex min-h-0 flex-1 flex-col px-2">
            <Switch>
              <Match when={activeTab() === 'messages'}>
                <ChannelMessages autofocus={false} />
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
 * Inline channel detail for the channels view, composed from channel parts
 * (surface, tabs, top-bar pieces) instead of instantiating the channel block.
 * Remounts per channel id; the entity prop stays live for name/avatar/targets.
 */
export function ChannelDetailView(props: { channel: ChannelEntity }) {
  return (
    <Show when={props.channel.id} keyed>
      {(channelId) => (
        <ChannelDetail channelId={channelId} channel={props.channel} />
      )}
    </Show>
  );
}
