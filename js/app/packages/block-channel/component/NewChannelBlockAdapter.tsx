import {
  Channel as NewChannel,
  type ChannelHandle,
} from '@channel/Channel/Channel';
import { ChannelTopBarLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { createSignal, Match, Suspense, Switch } from 'solid-js';
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

function NewTop(props: {
  channelId: string;
  activeTab: ChannelTabId;
  onTabChange: (value: ChannelTabId) => void;
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
      <ChannelTopBarLiveIndicators />
    </Suspense>
  );
}

export function NewChannelBlockAdapter() {
  useBlockEntityCommands();

  const notificationSource = useGlobalNotificationSource();

  const channelId = useBlockId();
  const blockHandle = blockHandleSignal.get;
  const [activeTab, setActiveTab] =
    createSignal<ChannelTabId>(DEFAULT_CHANNEL_TAB);

  const onChannelReady = (handle: ChannelHandle) => {
    createMethodRegistration(blockHandle, {
      goToLocationFromParams: async (params: Record<string, unknown>) => {
        const threadId = params[URL_PARAMS.thread] as string | undefined;
        const messageId = params[URL_PARAMS.message] as string | undefined;

        // For compatibility the naming is  a little strange here.
        // New channels index by top level message and then spertately handle replies.
        // If we have a threadId that is actually the top level message and the reply is the message id.
        const topLevelMessageId = threadId ? threadId : messageId;
        const messageReplyId = threadId ? messageId : threadId;

        if (topLevelMessageId && handle) {
          setActiveTab(DEFAULT_CHANNEL_TAB);
          handle.goToMessage(topLevelMessageId, messageReplyId);
        }
      },
    });
  };

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <ChannelDebouncedNotificationReadMarker
        notificationSource={notificationSource}
        channelId={channelId}
        debounceTime={500}
      />
      <div class="relative h-full flex flex-col">
        <Switch>
          <Match when={activeTab() === 'messages'}>
            <NewChannel channelId={channelId} onHandleReady={onChannelReady} />
          </Match>
          <Match when={activeTab() === 'attachments'}>
            <ChannelAttachmentsTab channelId={channelId} />
          </Match>
          <Match when={activeTab() === 'participants'}>
            <ChannelParticipantsTab channelId={channelId} />
          </Match>
        </Switch>
        <NewTop
          channelId={channelId}
          activeTab={activeTab()}
          onTabChange={setActiveTab}
        />
      </div>
    </EntityPermissionsGate>
  );
}
