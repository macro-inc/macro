import { commsServiceClient } from '@service-comms/client';
import { channelStore } from './channel';

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
