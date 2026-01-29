import { invalidateChannelsActivity } from '@queries/channel/activity';
import { commsServiceClient } from '@service-comms/client';

export async function postChannelViewActivity(channelId: string) {
  if (!channelId) return;

  await commsServiceClient.postActivity({
    activity_type: 'view',
    channel_id: channelId,
  });

  invalidateChannelsActivity();
}

export function invalidateActivity() {
  invalidateChannelsActivity();
}
