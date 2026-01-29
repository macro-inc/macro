import { commsServiceClient } from '@service-comms/client';

export async function postTypingUpdate(
  channelId: string,
  action: 'start' | 'stop',
  threadId?: string
) {
  if (!channelId) return;

  try {
    await commsServiceClient.postTypingUpdate({
      channel_id: channelId,
      action,
      thread_id: threadId,
    });
  } catch (e) {
    console.error(`failed to post typing update ${e}`);
  }
}
