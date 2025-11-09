import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import { toast } from 'core/component/Toast/Toast';
import { channelStore } from './channel';

export function useAddParticipantsToChannel() {
  const [channel, setChannel] = channelStore;
  const { track } = withAnalytics();

  return async (participants: string[]) => {
    const channelId = channel.channel?.id;
    if (!channelId) {
      console.error(
        'tried to add participants to a channel that does not exist'
      );
      return;
    }

    let newParticipants: ChannelParticipant[] = participants.map((p) => ({
      user_id: p,
      role: 'member',
      left_at: null,
      joined_at: new Date().toISOString(),
      channel_id: channelId,
    }));

    setChannel('participants', (prev) => [...prev, ...newParticipants]);

    const res = await commsServiceClient.addParticipantsToChanenl({
      channel_id: channelId,
      participants: participants,
    });

    if (isErr(res)) {
      toast.failure('Failed to add participants to channel');
      console.error(res);
      return;
    }

    track(TrackingEvents.BLOCKCHANNEL.PARTICIPANT.ADD);
  };
}

export function useRemoveParticipantsFromChannel() {
  const [channel, setChannel] = channelStore;

  return async (participants: string[]) => {
    const channelId = channel.channel?.id;
    if (!channelId) {
      console.error(
        'tried to remove participants from a channel that does not exist'
      );
      return;
    }

    setChannel('participants', (prev) =>
      prev.filter((p) => !participants.includes(p.user_id))
    );

    const res = await commsServiceClient.removeParticipantsFromChannel({
      channel_id: channelId,
      participants: participants,
    });

    if (isErr(res)) {
      toast.failure('Failed to remove participants from channel');
      console.error(res);
      return;
    }
  };
}
