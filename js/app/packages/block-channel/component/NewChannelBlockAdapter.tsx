import {
  Channel as NewChannel,
  type ChannelHandle,
} from '@channel/Channel/Channel';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { createSignal, Suspense } from 'solid-js';
import { blockHandleSignal } from '@core/signal/load';
import { createMethodRegistration } from '@core/orchestrator';
import { URL_PARAMS } from '@block-channel/constants';
import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { ChannelTopLeft } from './Top';
import { useChannelName, useChannelType } from '@core/context/channels';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';

function NewTop(props: { channelId: string }) {
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;

  return (
    <Suspense>
      <ChannelTopLeft
        channelId={props.channelId}
        channelType={channelType()!}
        participants={participants() ?? []}
        channelName={channelName() ?? 'New Channel'}
      />
    </Suspense>
  );
}

export function NewChannelBlockAdapter() {
  useBlockEntityCommands();
  const channelId = useBlockId();
  const [channelHandle, setChannelHandle] = createSignal<ChannelHandle>();

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
      <NewChannel channelId={channelId} onHandleReady={setChannelHandle} />
      <NewTop channelId={channelId} />
    </EntityPermissionsGate>
  );
}
