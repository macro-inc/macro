import {
  Channel as NewChannel,
  type ChannelHandle,
} from '@channel/Channel/Channel';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { createMemo, createSignal } from 'solid-js';
import { blockHandleSignal } from '@core/signal/load';
import { createMethodRegistration } from '@core/orchestrator';
import { URL_PARAMS } from '@block-channel/constants';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { ChannelTypeEnum } from '@service-comms/client';
import { useChannelQuery } from '@queries/channel/channel';
import { isChannelAdminOrOwner } from '@queries/channel/derived';
import { ChannelTopLeft } from './Top';

export function NewChannelBlockAdapter() {
  useBlockEntityCommands();
  const channelId = useBlockId();
  const [channelHandle, setChannelHandle] = createSignal<ChannelHandle>();
  const channelQuery = useChannelQuery(() => channelId);
  const channel = createMemo(() => channelQuery.data?.channel);
  const participants = createMemo(() => channelQuery.data?.participants ?? []);
  const lockRename = createMemo(() => {
    const channelData = channelQuery.data;
    if (!channelData) return true;

    return (
      channelData.channel.channel_type === ChannelTypeEnum.DirectMessage ||
      !isChannelAdminOrOwner(channelData)
    );
  });

  const blockHandle = blockHandleSignal.get;
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      const threadId = params[URL_PARAMS.thread] as string | undefined;
      const messageId = params[URL_PARAMS.message] as string | undefined;

      // For compatibility the naming is  a little strange here.
      // New channels index by top level message and then spertately handle replies.
      // If we have a threadId that is actually the top level message and the reply is the message id.
      const topLevelMessageId = threadId ? threadId : messageId;
      const messageReplyId = threadId ? messageId : threadId;
      const handle = channelHandle();

      if (topLevelMessageId && handle) {
        handle.goToMessage(topLevelMessageId, messageReplyId);
      }
    },
  });

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <ChannelTopLeft
        channelId={channelId}
        channelType={channel()?.channel_type ?? ChannelTypeEnum.Public}
        participants={participants()}
        channelName={channel()?.name ?? 'New Channel'}
        lockRename={lockRename()}
      />
      <NewChannel channelId={channelId} onHandleReady={setChannelHandle} />
    </EntityPermissionsGate>
  );
}
