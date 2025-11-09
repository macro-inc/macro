import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { createBlockStore } from '@core/block';
import { commsServiceClient } from '@service-comms/client';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { useUserId } from '@service-gql/client';
import { channelStore } from './channel';

type CountedReaction = {
  emoji: string;
  users: string[];
};

export const messageToReactionStore = createBlockStore<
  Record<string, CountedReaction[]>
>({});

export async function reactToMessage(emoji: string, messageId: string) {
  const { track } = withAnalytics();
  const channel = channelStore.get;
  const channelId = channel?.id;
  const userId_ = useUserId();
  const userId = userId_();
  if (!channelId || !userId) return;

  const messageToReaction = messageToReactionStore.get;
  let action: 'Add' | 'Remove' = 'Add';

  let prev = messageToReaction?.[messageId] ?? [];

  if (
    prev.some(
      (reaction) => reaction.emoji === emoji && reaction.users.includes(userId)
    )
  ) {
    action = 'Remove';
  }

  try {
    await commsServiceClient.postReaction({
      channel_id: channelId,
      action,
      emoji: emoji,
      message_id: messageId,
    });
  } catch (e) {
    console.error(e);
  }

  track(TrackingEvents.BLOCKCHANNEL.MESSAGE.REACTION, {
    channelId,
    emoji,
    action,
  });
}

createConnectionBlockWebsocketEffect((msg) => {
  if (msg.type === 'comms_reaction') {
    const userId_ = useUserId();
    const userId = userId_();
    const channel = channelStore.get;
    const channelId = channel?.channel?.id;
    const setMessageToReaction = messageToReactionStore.set;
    if (!channelId || !userId) return;
    //TODO: make this better, once things are more fleshed out
    let value = JSON.parse(msg.data as any);
    const { channel_id: targetChannelId, reactions } = value;

    if (targetChannelId === channelId) {
      setMessageToReaction(value.message_id, reactions);
    }
  }
});
