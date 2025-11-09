import { createBlockSignal } from '@core/block';
import { commsServiceClient } from '@service-comms/client';
import { createConnectionBlockWebsocketEffect } from '@service-connection/websocket';
import { useUserId } from '@service-gql/client';
import { channelStore } from './channel';

export const usersTypingSignal = createBlockSignal<
  Map<string | null, Set<string>>
>(new Map([[null, new Set()]]));

function addTypingUser(user_id: string, thread_id: string | null = null) {
  usersTypingSignal.set((prev) => {
    const newMap = new Map(prev);
    const threadUsers = newMap.get(thread_id) || new Set();
    newMap.set(thread_id, new Set([...threadUsers, user_id]));
    return newMap;
  });
}

function removeTypingUser(user_id: string, thread_id: string | null = null) {
  usersTypingSignal.set((prev) => {
    const newMap = new Map(prev);
    const threadUsers = newMap.get(thread_id);
    if (threadUsers) {
      newMap.set(
        thread_id,
        new Set(Array.from(threadUsers).filter((id) => id !== user_id))
      );
    }
    return newMap;
  });
}

export async function postTypingUpdate(
  action: 'start' | 'stop',
  threadId?: string
) {
  const channel = channelStore.get;
  const channelId = channel?.channel?.id;
  if (!channelId || !channel) return;

  try {
    await commsServiceClient.postTypingUpdate({
      channel_id: channelId,
      action,
      thread_id: threadId,
    });
  } catch (e) {
    console.error(`failed to post typing update ${e}`);
    // TODO: handle error
  }
}

createConnectionBlockWebsocketEffect((msg) => {
  if (msg.type === 'comms_typing') {
    const userId_ = useUserId();
    const userId = userId_();
    const channel = channelStore.get;
    const channelId = channel?.channel?.id;
    if (!channelId || !userId) return;
    //TODO: make this better, once things are more fleshed out
    let value = JSON.parse(msg.data as any);

    const { channel_id: targetChannelId, user_id, action, thread_id } = value;

    // don't care about updates for the current user
    if (user_id === userId) return;

    if (targetChannelId === channelId) {
      if (action === 'start') {
        addTypingUser(user_id, thread_id);
      } else {
        removeTypingUser(user_id, thread_id);
      }
    }
  }
});
