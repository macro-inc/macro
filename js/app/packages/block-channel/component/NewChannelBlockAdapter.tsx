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
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { createSignal, Match, Show, Suspense, Switch } from 'solid-js';
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
  CallProvider,
  ChannelCallButton,
  ChannelCallTab,
  useCall,
} from '@channel/Call';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';

type ChannelTargetMessageParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
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
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const call = useCall(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;
  const tabs = () => {
    let filtered = [...CHANNEL_TABS];
    if (channelType() === ChannelTypeEnum.DirectMessage)
      filtered = filtered.filter((tab) => tab.value !== 'participants');
    if (!ENABLE_CALLS() || !call.isInThisChannel())
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
      <Show when={ENABLE_CALLS()}>
        <SplitHeaderRight>
          <ChannelCallButton channelId={props.channelId} />
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
  const [activeTab, setActiveTab] =
    createSignal<ChannelTabId>(DEFAULT_CHANNEL_TAB);

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

  const onChannelReady = (handle: ChannelHandle) => {
    createMethodRegistration(blockHandle, {
      goToLocationFromParams: async (params: ChannelTargetMessageParams) => {
        const { targetMessageId, targetMessageReplyId } =
          convertTargetMessage(params);

        if (targetMessageId && handle) {
          setActiveTab(DEFAULT_CHANNEL_TAB);
          handle.goToMessage(targetMessageId, targetMessageReplyId);
        }
      },
    });
  };

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <CallProvider>
        <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
          <div class="h-full flex flex-col">
            <Switch>
              <Match when={activeTab() === 'messages'}>
                <NewChannel
                  channelId={channelId}
                  onHandleReady={onChannelReady}
                  autofocus={!isPreview}
                  {...convertTargetMessage(props)}
                />
              </Match>
              <Match when={activeTab() === 'attachments'}>
                <ChannelAttachmentsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'participants'}>
                <ChannelParticipantsTab channelId={channelId} />
              </Match>
              <Match when={activeTab() === 'call'}>
                <ChannelCallTab channelId={channelId} />
              </Match>
            </Switch>
            <NewTop channelId={channelId} />
          </div>
        </ChannelTabProvider>
      </CallProvider>
    </EntityPermissionsGate>
  );
}
