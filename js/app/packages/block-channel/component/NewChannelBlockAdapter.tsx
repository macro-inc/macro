import {
  Channel as NewChannel,
  type ChannelHandle,
  type ChannelProps,
} from '@channel/Channel/Channel';
import { ChannelTopBarLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import {
  type Component,
  createSignal,
  Match,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
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
import { ChannelDebouncedNotificationReadMarker } from '@notifications/components/DebouncedNotificationReadMarker';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import type { BlockChannelProps } from './Block';
import { CallProvider, CallOverlay, useCall } from '@channel/Call';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { Button } from '@ui/components/Button';
import PhoneIcon from '@icon/regular/phone.svg';
import PhoneDisconnectIcon from '@icon/regular/phone-disconnect.svg';

type ChannelTargetMessageParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
};

type ChannelPropsTargetMessage = Pick<
  ChannelProps,
  'targetMessageId' | 'targetMessageReplyId'
>;

const CallIcon: Component<{ isInCall: () => boolean }> = (props) => (
  <Show when={props.isInCall()} fallback={<PhoneIcon />}>
    <PhoneDisconnectIcon />
  </Show>
);

function CallButton(props: {
  joinCall: () => Promise<void>;
  leaveCall: () => Promise<void>;
  isInCall: () => boolean;
  isPending: () => boolean;
}) {
  const handleClick = async () => {
    if (props.isPending()) return;
    try {
      if (props.isInCall()) {
        await props.leaveCall();
      } else {
        await props.joinCall();
      }
    } catch (e) {
      console.error('Call action failed', e);
    }
  };

  return (
    <Button
      onClick={handleClick}
      disabled={props.isPending()}
      tooltip={props.isInCall() ? 'Leave Call' : 'Call'}
      class={
        props.isInCall()
          ? 'px-1 bg-accent/20 hover:bg-accent/30 text-accent-ink'
          : 'px-1'
      }
      size="icon-sm"
    >
      <CallIcon isInCall={props.isInCall} />
    </Button>
  );
}

function NewTop(props: {
  channelId: string;
  activeTab: ChannelTabId;
  onTabChange: (value: ChannelTabId) => void;
  joinCall: () => Promise<void>;
  leaveCall: () => Promise<void>;
  isInCall: () => boolean;
  isPending: () => boolean;
}) {
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;
  const tabs = () =>
    channelType() === ChannelTypeEnum.DirectMessage
      ? CHANNEL_TABS.filter((tab) => tab.value !== 'participants')
      : CHANNEL_TABS;

  return (
    <Suspense>
      <ChannelTopLeft
        channelId={props.channelId}
        channelType={channelType()!}
        participants={participants() ?? []}
        channelName={channelName() ?? 'New Channel'}
        tabs={tabs()}
        activeTab={props.activeTab}
        onTabChange={props.onTabChange}
      />
      <Show when={ENABLE_CALLS()}>
        <SplitHeaderRight>
          <CallButton
            joinCall={props.joinCall}
            leaveCall={props.leaveCall}
            isInCall={props.isInCall}
            isPending={props.isPending}
          />
        </SplitHeaderRight>
      </Show>
      <ChannelTopBarLiveIndicators />
    </Suspense>
  );
}

export function NewChannelBlockAdapter(props: BlockChannelProps) {
  useBlockEntityCommands();

  const notificationSource = useGlobalNotificationSource();

  const channelId = useBlockId();

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <ChannelDebouncedNotificationReadMarker
        notificationSource={notificationSource}
        channelId={channelId}
        debounceTime={500}
      />
      <CallProvider>
        <NewChannelBlockAdapterInner channelId={channelId} {...props} />
      </CallProvider>
    </EntityPermissionsGate>
  );
}

function NewChannelBlockAdapterInner(
  props: { channelId: string } & BlockChannelProps
) {
  const blockHandle = blockHandleSignal.get;
  const [activeTab, setActiveTab] =
    createSignal<ChannelTabId>(DEFAULT_CHANNEL_TAB);
  const call = useCall(() => props.channelId);

  const convertTargetMessage = (
    params: ChannelTargetMessageParams
  ): ChannelPropsTargetMessage => {
    const messageId = params[URL_PARAMS.message] as string | undefined;
    const threadId = params[URL_PARAMS.thread] as string | undefined;

    // For compatibility the naming is  a little strange here.
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
    <div class="relative h-full flex flex-col">
      <Switch>
        <Match when={activeTab() === 'messages'}>
          <NewChannel
            channelId={props.channelId}
            onHandleReady={onChannelReady}
            {...convertTargetMessage(props)}
          />
        </Match>
        <Match when={activeTab() === 'attachments'}>
          <ChannelAttachmentsTab channelId={props.channelId} />
        </Match>
        <Match when={activeTab() === 'participants'}>
          <ChannelParticipantsTab channelId={props.channelId} />
        </Match>
      </Switch>
      <Show when={call.isInThisChannel()}>
        <div class="absolute inset-0 z-50">
          <CallOverlay onLeave={call.leaveCall} />
        </div>
      </Show>
      <NewTop
        channelId={props.channelId}
        activeTab={activeTab()}
        onTabChange={setActiveTab}
        joinCall={call.joinCall}
        leaveCall={call.leaveCall}
        isInCall={call.isInThisChannel}
        isPending={() => call.isJoining() || call.isLeaving()}
      />
    </div>
  );
}
