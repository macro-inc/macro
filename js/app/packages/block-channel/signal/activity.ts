import { createBlockSignal } from '@core/block';
import { useChannelActivity } from '@core/context/channels';
import { invalidateChannelsActivity } from '@queries/channel/activity';
import { commsServiceClient } from '@service-comms/client';
import type { Activity as ChannelActivity } from '@service-comms/generated/models/activity';

export const latestActivitySignal = createBlockSignal<ChannelActivity>();
export const openedChannelSignal = createBlockSignal<Date>();

export async function updateActivityOnChannelOpen(channelId: string) {
  if (!channelId) return;

  const latestActivity = useChannelActivity(channelId);

  const setLatestActivity = latestActivitySignal.set;
  const setOpenedChannel = openedChannelSignal.set;

  const lastActivity = latestActivity();

  if (lastActivity) {
    setLatestActivity(lastActivity);
  }

  setOpenedChannel(new Date());

  await commsServiceClient.postActivity({
    activity_type: 'view',
    channel_id: channelId,
  });

  invalidateChannelsActivity();
}

export async function updateActivityOnChannelClose(channelId: string) {
  if (!channelId) return;

  await commsServiceClient.postActivity({
    activity_type: 'view',
    channel_id: channelId,
  });
}

export async function updateActivityOnMessageReceived(
  incomingChannelId: string,
  currentChannelId: string
) {
  if (!currentChannelId || currentChannelId === incomingChannelId) return;
  invalidateChannelsActivity();
}

export async function updateActivityOnMessageSend() {
  invalidateChannelsActivity();
}
