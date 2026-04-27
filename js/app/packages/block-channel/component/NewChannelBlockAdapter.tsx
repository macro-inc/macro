import {
  Channel as NewChannel,
  type ChannelHandle,
  type ChannelProps,
} from '@channel/Channel/Channel';
import { ChannelTopBarLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import {
  ChannelTabProvider,
  useChannelTab,
} from '@channel/Channel/ChannelTabContext';
import {
  isJoinCallRequested,
  URL_PARAMS as CHANNEL_URL_PARAMS,
} from '@channel/Channel/link';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { createSignal, Match, onMount, Show, Suspense, Switch } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { blockHandleSignal } from '@core/signal/load';
import { createMethodRegistration } from '@core/orchestrator';
import { URL_PARAMS } from '@block-channel/constants';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { ChannelTopLeft } from './Top';
import { useChannelName, useChannelType } from '@core/context/channels';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { ChannelTypeEnum } from '@service-comms/client';
import {
  CHANNEL_TABS,
  DEFAULT_CHANNEL_TAB,
  type ChannelTabId,
} from '@channel/Channel/channel-tabs';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import {
  CallAudioSink,
  CallEventSync,
  CallProvider,
  ChannelCallAutoJoin,
  ChannelCallButton,
  ChannelCallTab,
  useCall,
} from '@channel/Call';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import {
  ChatWithAgentButton,
  toChatChannelType,
} from '@app/component/ChatWithAgentButton';
import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { globalSplitManager } from '@app/signal/splitLayout';

type ChannelTargetMessageParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
  [CHANNEL_URL_PARAMS.joinCall]?: string;
};

export type BlockChannelProps = ChannelTargetMessageParams;

type ChannelPropsTargetMessage = Pick<
  ChannelProps,
  'targetMessageId' | 'targetMessageReplyId'
>;

function CallTabLabel() {
  return (
    <span class="flex items-center gap-1.5">
      <span class="size-1.5 rounded-full bg-accent animate-pulse" />
      Call
    </span>
  );
}

function NewTop(props: { channelId: string }) {
  const { activeTab, setActiveTab } = useChannelTab();
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const chatChannelType = () => toChatChannelType(channelType());
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const call = useCall(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;
  // Show the Call tab whenever we're actually in the call, mid-join, or
  // the tab is being displayed (e.g. via the auto-join flow that flips
  // `activeTab` to `call` before the join request resolves).
  const showCallTab = () =>
    ENABLE_CALLS() &&
    (call.isInThisChannel() || call.isJoining() || activeTab() === 'call');
  const tabs = () => {
    let filtered = [...CHANNEL_TABS];
    if (channelType() === ChannelTypeEnum.DirectMessage)
      filtered = filtered.filter((tab) => tab.value !== 'participants');
    if (!showCallTab())
      filtered = filtered.filter((tab) => tab.value !== 'call');
    return filtered.map((tab) =>
      tab.value === 'call' ? { ...tab, label: <CallTabLabel /> } : tab
    );
  };

  return (
    <Suspense>
      <ChannelTopLeft
        channelId={props.channelId}
        channelType={channelType()!}
        participants={participants() ?? []}
        channelName={channelName() ?? 'New Channel'}
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={setActiveTab}
      />
      <Show when={chatChannelType() || ENABLE_CALLS()}>
        <SplitHeaderRight>
          <div class="flex items-center gap-1.5">
            <Show when={chatChannelType()}>
              {(type) => (
                <ChatWithAgentButton
                  entity={{
                    type: 'channel',
                    id: props.channelId,
                    name: channelName() ?? 'Channel',
                    channelType: type(),
                  }}
                />
              )}
            </Show>
            <Show when={ENABLE_CALLS()}>
              <ChannelCallButton channelId={props.channelId} />
            </Show>
          </div>
        </SplitHeaderRight>
      </Show>
      <ChannelTopBarLiveIndicators />
    </Suspense>
  );
}

export function NewChannelBlockAdapter(props: BlockChannelProps) {
  useBlockEntityCommands();

  const isPreview = !!useMaybePreviewPanel();
  const channelId = useBlockId();
  const blockHandle = blockHandleSignal.get;
  const [searchParams, setSearchParams] = useSearchParams();

  // Decide whether the user asked to auto-join the call (via ?join_call=true
  // deep link or programmatic open props) before creating signals so we
  // can land directly on the Call tab without flashing Messages first.
  // Skipped inside a preview panel so hover-previews don't auto-join.
  const wantsJoinCall =
    !isPreview &&
    (isJoinCallRequested(props[CHANNEL_URL_PARAMS.joinCall]) ||
      isJoinCallRequested(searchParams[CHANNEL_URL_PARAMS.joinCall]));

  const [activeTab, setActiveTab] = createSignal<ChannelTabId>(
    wantsJoinCall ? 'call' : DEFAULT_CHANNEL_TAB
  );
  const [pendingJoinCall, setPendingJoinCall] = createSignal(wantsJoinCall);

  // Clear the URL param after consuming it so a reload doesn't re-trigger
  // the join if the user has since left the call.
  onMount(() => {
    if (
      wantsJoinCall &&
      searchParams[CHANNEL_URL_PARAMS.joinCall] !== undefined
    ) {
      setSearchParams(
        { [CHANNEL_URL_PARAMS.joinCall]: undefined },
        { replace: true }
      );
    }
  });

  const convertTargetMessage = (
    params: ChannelTargetMessageParams
  ): ChannelPropsTargetMessage => {
    const messageId = params[URL_PARAMS.message] as string | undefined;
    const threadId = params[URL_PARAMS.thread] as string | undefined;

    // For compatibility the naming is a little strange here.
    // New channels index by top level message and then separately handle replies.
    // If we have a threadId that is actually the top level message and the reply is the message id.
    const topLevelMessageId = threadId ? threadId : messageId;
    const messageReplyId = threadId ? messageId : threadId;

    return {
      targetMessageId: topLevelMessageId,
      targetMessageReplyId: messageReplyId,
    };
  };

  const initialTargetMessageParams = (): ChannelTargetMessageParams => {
    const hasPropsTarget =
      props[URL_PARAMS.message] !== undefined ||
      props[URL_PARAMS.thread] !== undefined;
    if (hasPropsTarget) {
      return {
        [URL_PARAMS.message]: props[URL_PARAMS.message],
        [URL_PARAMS.thread]: props[URL_PARAMS.thread],
      };
    }
    const isSingleSplit = globalSplitManager()?.splits().length === 1;
    if (!isSingleSplit) return {};
    return {
      [URL_PARAMS.message]: searchParams[URL_PARAMS.message] as
        | string
        | undefined,
      [URL_PARAMS.thread]: searchParams[URL_PARAMS.thread] as
        | string
        | undefined,
    };
  };

  const onChannelReady = (handle: ChannelHandle) => {
    createMethodRegistration(blockHandle, {
      goToLocationFromParams: async (params: ChannelTargetMessageParams) => {
        const { targetMessageId, targetMessageReplyId } =
          convertTargetMessage(params);

        if (targetMessageId && handle) {
          setActiveTab(DEFAULT_CHANNEL_TAB);
          handle.goToMessage(targetMessageId, targetMessageReplyId);
        }

        if (isJoinCallRequested(params[CHANNEL_URL_PARAMS.joinCall])) {
          // Flip to the call tab eagerly so the user sees the "Joining
          // call…" placeholder instead of whatever tab they were on.
          setActiveTab('call');
          setPendingJoinCall(true);
        }
      },
    });
  };

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <CallProvider>
        <CallEventSync />
        <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
          <ChannelCallAutoJoin
            channelId={channelId}
            pendingJoinCall={pendingJoinCall}
            onHandled={() => setPendingJoinCall(false)}
          />
          <div class="h-full flex flex-col px-2 mobile:px-0">
            {/*
              Mounted above <Switch> so remote call audio keeps playing when
              the user switches from the Call tab to Messages / Attachments /
              Participants. See CallAudioSink for details.
            */}
            <CallAudioSink />
            <Switch>
              <Match when={activeTab() === 'messages'}>
                <NewChannel
                  channelId={channelId}
                  onHandleReady={onChannelReady}
                  autofocus={!isPreview}
                  {...convertTargetMessage(initialTargetMessageParams())}
                />
              </Match>
              <Match when={activeTab() === 'attachments'}>
                <ChannelAttachmentsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'participants'}>
                <ChannelParticipantsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'call'}>
                <ChannelCallTab
                  channelId={channelId}
                  pendingJoin={pendingJoinCall}
                />
              </Match>
            </Switch>
            <NewTop channelId={channelId} />
          </div>
        </ChannelTabProvider>
      </CallProvider>
    </EntityPermissionsGate>
  );
}
